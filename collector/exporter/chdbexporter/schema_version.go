// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"
	"fmt"
	"strconv"
	"sync"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"go.uber.org/zap"
)

// localSchemaVersion is the shape of the local store. Bump it in the same
// commit as any change under internal/sqltemplates that alters a table's
// shape. TestSchemaTemplatesMatchVersion fails when the two move apart.
//
// A mismatch drops the store and rebuilds it. There is no ALTER path, because
// ClickHouse cannot rewrite a sort key or a partition key, nor change the type
// of a column either one uses, and those are what schema changes here keep
// touching. Local telemetry is a rolling cache bounded by `ttl` and never a
// system of record, so a rebuild costs at most one ttl window of local data.
//
// Version 1 is the first stamped shape. Every store built before it reads as 0
// and rebuilds once.
const localSchemaVersion = 1

// schemaVersionTable holds exactly one row: the version the store was built
// at. It lives inside the store rather than in a file beside it so that it
// cannot outlive the data. Delete the store and the marker goes with it, and
// the next startup correctly rebuilds. A missing or empty table reads as 0.
const schemaVersionTable = "_everr_schema"

// Table names from the layout that predates naming local tables after the
// cloud ones. Dropping them is what retires the old adoption path: a store
// that still holds them has orphans that nothing reads and nothing else would
// ever remove.
var legacyLocalTableNames = []string{
	"otel_logs",
	"otel_traces",
	"otel_profiles",
	"otel_metrics_gauge",
	"otel_metrics_sum",
	"otel_metrics_histogram",
	"otel_metrics_exponential_histogram",
	"otel_metrics_summary",
}

// schemaGuard runs the version check once per store. Each signal has its own
// exporter with its own start(), all of them share one chDB handle, and the
// first one through has to finish the rebuild before any other creates a
// table. It hangs off Config because that is the one value the collector hands
// to every signal of a single exporter component.
type schemaGuard struct {
	once sync.Once
	err  error
}

// ensureLocalSchema rebuilds the store when the version it was built at does
// not match this binary's. Call it once the database exists and before
// creating any table.
func ensureLocalSchema(ctx context.Context, db driver.Conn, cfg *Config, logger *zap.Logger) error {
	guard := cfg.schema
	if guard == nil {
		// A Config assembled by hand rather than by createDefaultConfig, which
		// only happens in a test holding a single exporter. Nothing to
		// serialise against.
		return rebuildStaleStore(ctx, db, cfg, logger)
	}

	guard.once.Do(func() {
		guard.err = rebuildStaleStore(ctx, db, cfg, logger)
	})

	return guard.err
}

func rebuildStaleStore(ctx context.Context, db driver.Conn, cfg *Config, logger *zap.Logger) error {
	database := cfg.database()

	found, err := readSchemaVersion(ctx, db, database)
	if err != nil {
		return err
	}
	if found == localSchemaVersion {
		return nil
	}

	logger.Info("local schema changed, rebuilding the store",
		zap.Int("from_version", found),
		zap.Int("to_version", localSchemaVersion),
	)

	for _, table := range staleTableNames(cfg) {
		// DROP TABLE also removes materialized views and plain views, which is
		// what the oldest layout left behind under these names.
		if err := db.Exec(ctx, fmt.Sprintf("DROP TABLE IF EXISTS %q.%q", database, table)); err != nil {
			return fmt.Errorf("drop %s during schema rebuild: %w", table, err)
		}
	}

	// Stamped after the drop, not after the creates. Every caller creates with
	// CREATE TABLE IF NOT EXISTS, so once the old shapes are gone, a table that
	// exists was written by this binary and a table that is missing is created
	// on the next startup. A failed drop returns above and stamps nothing, so
	// an old shape can never end up behind a current marker.
	return writeSchemaVersion(ctx, db, database, localSchemaVersion)
}

// staleTableNames is everything a rebuild removes, views before the tables
// they read. It covers the names this config uses and the names earlier
// layouts used, because a rebuild that leaves either behind leaves a table
// nothing will ever drop.
func staleTableNames(cfg *Config) []string {
	names := []string{
		cfg.TracesTableName + "_trace_id_ts_mv",
		"otel_traces_trace_id_ts_mv",
		cfg.TracesTableName + "_trace_id_ts",
		"otel_traces_trace_id_ts",
		cfg.LogsTableName,
		cfg.TracesTableName,
		cfg.ProfilesTableName,
		cfg.MetricsTables.Gauge.Name,
		cfg.MetricsTables.Sum.Name,
		cfg.MetricsTables.Histogram.Name,
		cfg.MetricsTables.ExponentialHistogram.Name,
		cfg.MetricsTables.Summary.Name,
	}
	names = append(names, legacyLocalTableNames...)

	seen := make(map[string]struct{}, len(names))
	unique := make([]string, 0, len(names))
	for _, name := range names {
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		unique = append(unique, name)
	}

	return unique
}

func readSchemaVersion(ctx context.Context, db driver.Conn, database string) (int, error) {
	ddl := fmt.Sprintf(
		"CREATE TABLE IF NOT EXISTS %q.%q (version UInt32) ENGINE = TinyLog",
		database, schemaVersionTable,
	)
	if err := db.Exec(ctx, ddl); err != nil {
		return 0, fmt.Errorf("create schema version table: %w", err)
	}

	// `AS name` and a string, because the chdb rows shim maps the first
	// scanned value to a column it always calls `name` and only assigns into
	// *string.
	query := fmt.Sprintf(
		"SELECT toString(version) AS name FROM %q.%q LIMIT 1",
		database, schemaVersionTable,
	)
	rows, err := db.Query(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("read schema version: %w", err)
	}
	defer func() { _ = rows.Close() }()

	if !rows.Next() {
		return 0, rows.Err()
	}

	var raw string
	if err := rows.Scan(&raw); err != nil {
		return 0, err
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	version, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("parse schema version %q: %w", raw, err)
	}

	return version, nil
}

// writeSchemaVersion leaves exactly one row. Keeping a history and reading the
// maximum would hide a downgrade: an older binary would read the newer version
// and skip the rebuild it needs.
func writeSchemaVersion(ctx context.Context, db driver.Conn, database string, version int) error {
	if err := db.Exec(ctx, fmt.Sprintf("TRUNCATE TABLE %q.%q", database, schemaVersionTable)); err != nil {
		return fmt.Errorf("clear schema version: %w", err)
	}

	insert := fmt.Sprintf(
		"INSERT INTO %q.%q (version) VALUES (%d)",
		database, schemaVersionTable, version,
	)
	if err := db.Exec(ctx, insert); err != nil {
		return fmt.Errorf("stamp schema version: %w", err)
	}

	return nil
}
