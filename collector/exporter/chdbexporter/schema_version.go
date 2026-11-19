// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"sync"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

// Bump localSchemaVersion when a table shape changes, alongside the template
// digest. A version mismatch discards cached local telemetry and rebuilds it.
const localSchemaVersion = 2

// Keep the version marker inside the store so deleting the data also resets it.
// A missing or empty marker reads as version 0.
const schemaVersionTable = "_everr_schema"

// Include tables from before the local names matched the cloud names.
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

// store is the chDB store behind one factory. Every exporter component the
// factory builds shares it, and each signal of a component has its own
// exporter with its own start(). The first start has to finish the rebuild
// before any other creates a table, and the rebuild has to drop the tables of
// every component, not only the first one's: a table of another component that
// an older build created would otherwise keep its old shape for ever.
//
// Components register their config when the collector builds them, and the
// collector builds every component before it starts any, so the rebuild sees
// all of them.
type store struct {
	handle *chdb.Handle

	mu       sync.Mutex
	configs  []*Config
	rebuilds map[string]*rebuild
}

// rebuild is the version check of one database. The version marker lives in
// the database, so that is the unit that is checked once.
type rebuild struct {
	once sync.Once
	err  error
}

func newStore(handle *chdb.Handle) *store {
	return &store{handle: handle, rebuilds: map[string]*rebuild{}}
}

// storeOf is the store an exporter constructor was given, or a store of its
// own for the tests that build one exporter by hand.
func storeOf(stores []*store) *store {
	if len(stores) > 0 {
		return stores[0]
	}
	return newStore(nil)
}

func (s *store) register(cfg *Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !slices.Contains(s.configs, cfg) {
		s.configs = append(s.configs, cfg)
	}
}

// ensureLocalSchema rebuilds the store when the version it was built at does
// not match this binary's. Call it once the database exists and before
// creating any table. Concurrent callers wait for the one that runs it.
func (s *store) ensureLocalSchema(ctx context.Context, db driver.Conn, cfg *Config, logger *zap.Logger) error {
	database := cfg.database()

	s.mu.Lock()
	r, ok := s.rebuilds[database]
	if !ok {
		r = &rebuild{}
		s.rebuilds[database] = r
	}
	configs := slices.Clone(s.configs)
	s.mu.Unlock()

	r.once.Do(func() {
		// A config nobody registered is a test that built an exporter by hand.
		if !slices.Contains(configs, cfg) {
			configs = append(configs, cfg)
		}
		configs = slices.DeleteFunc(configs, func(c *Config) bool { return c.database() != database })
		r.err = rebuildStaleStore(ctx, db, database, configs, logger)
	})

	return r.err
}

func rebuildStaleStore(ctx context.Context, db driver.Conn, database string, configs []*Config, logger *zap.Logger) error {
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

	for _, table := range staleTableNames(configs...) {
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
// they read. It covers the names these configs use and the names earlier
// layouts used, because a rebuild that leaves either behind leaves a table
// nothing will ever drop.
func staleTableNames(cfgs ...*Config) []string {
	var views, tables []string
	for _, cfg := range cfgs {
		views = append(views, cfg.TracesTableName+"_trace_id_ts_mv")
		tables = append(tables,
			cfg.TracesTableName+"_trace_id_ts",
			cfg.LogsTableName,
			cfg.TracesTableName,
			cfg.ProfilesTableName,
			cfg.MetricsTables.Gauge.Name,
			cfg.MetricsTables.Sum.Name,
			cfg.MetricsTables.Histogram.Name,
			cfg.MetricsTables.ExponentialHistogram.Name,
			cfg.MetricsTables.Summary.Name,
		)
	}
	// The oldest layout named its lookup table and view after otel_traces.
	views = append(views, "otel_traces_trace_id_ts_mv")
	tables = append(tables, "otel_traces_trace_id_ts")

	names := append(views, tables...)
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
