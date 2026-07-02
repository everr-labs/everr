// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"fmt"
	"strings"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

// Table names used by the schema layout that predates naming local tables
// after the cloud ones: raw otel_* tables exposed through plain views under
// the cloud-facing names.
const (
	legacyLogsTableName   = "otel_logs"
	legacyTracesTableName = "otel_traces"
)

// adoptLegacyLocalTable moves a pre-rename raw table under the cloud-facing
// name it used to be exposed as. The old layout wrote to legacyName and
// queried it through a plain view named currentName; the view holds no data
// and blocks the name, so it is dropped and the raw table renamed into its
// place, preserving the collected telemetry. The legacy table's existence is
// the marker, which makes this a one-shot: after the first startup on the
// new layout there is nothing left to adopt. Returns whether an adoption
// happened so callers can apply legacy-only schema fixups.
func adoptLegacyLocalTable(ctx context.Context, db driver.Conn, database, legacyName, currentName string) (bool, error) {
	if legacyName == currentName {
		return false, nil
	}

	legacyEngine, err := lookupTableEngine(ctx, db, database, legacyName)
	if err != nil {
		return false, fmt.Errorf("check legacy table %q: %w", legacyName, err)
	}
	if legacyEngine == "" {
		return false, nil
	}

	currentEngine, err := lookupTableEngine(ctx, db, database, currentName)
	if err != nil {
		return false, fmt.Errorf("check current table %q: %w", currentName, err)
	}
	if currentEngine != "" && currentEngine != "View" {
		// A real table already holds the cloud-facing name — e.g. a downgraded
		// collector recreated the legacy layout next to an already-adopted
		// table. Never drop a data-bearing table; keep it and leave the legacy
		// one behind to age out with its TTL.
		return false, nil
	}

	if currentEngine == "View" {
		drop := fmt.Sprintf(`DROP TABLE IF EXISTS %q.%q`, database, currentName)
		if err := db.Exec(ctx, drop); err != nil {
			return false, fmt.Errorf("drop legacy local view %q: %w", currentName, err)
		}
	}

	rename := fmt.Sprintf(`RENAME TABLE %q.%q TO %q.%q`, database, legacyName, database, currentName)
	if err := db.Exec(ctx, rename); err != nil {
		return false, fmt.Errorf("rename legacy local table %q to %q: %w", legacyName, currentName, err)
	}

	return true, nil
}

// adoptLegacyLogsTable renames the legacy logs table under the cloud-facing
// name; migrateLogsTable then brings it up to the current column set.
func adoptLegacyLogsTable(ctx context.Context, cfg *Config, db driver.Conn) error {
	_, err := adoptLegacyLocalTable(ctx, db, cfg.database(), legacyLogsTableName, cfg.LogsTableName)
	return err
}

// adoptLegacyTraceTables renames the legacy traces table and its trace-id
// lookup companion under the cloud-facing names. The legacy lookup MV stores
// a query referencing the old table names and holds no data of its own, so
// it is dropped; the create path recreates it against the renamed tables.
// Each step is guarded only by its own object's existence — not by whether
// the previous step ran this boot — so a startup interrupted between the
// renames finishes the remaining ones on the next boot instead of stranding
// the companion table forever.
func adoptLegacyTraceTables(ctx context.Context, cfg *Config, db driver.Conn) error {
	if legacyTracesTableName == cfg.TracesTableName {
		return nil
	}

	// Only reached when the configured names differ from the legacy ones, so
	// this MV name can only be the stale legacy lookup MV.
	dropMV := fmt.Sprintf(`DROP TABLE IF EXISTS %q.%q`, cfg.database(), legacyTracesTableName+"_trace_id_ts_mv")
	if err := db.Exec(ctx, dropMV); err != nil {
		return fmt.Errorf("drop legacy trace-id lookup mv: %w", err)
	}

	if _, err := adoptLegacyLocalTable(ctx, db, cfg.database(), legacyTracesTableName, cfg.TracesTableName); err != nil {
		return err
	}

	_, err := adoptLegacyLocalTable(ctx, db, cfg.database(),
		legacyTracesTableName+"_trace_id_ts", cfg.TracesTableName+"_trace_id_ts")
	return err
}

// lookupTableEngine returns the engine of the named table or view, or ""
// when no such object exists. The result column is aliased to `name` because
// the chdb rows shim scans by the fixed DESC TABLE column list, whose first
// entry is `name` — and the WHERE columns are qualified with `t.` because
// ClickHouse resolves unqualified WHERE identifiers against SELECT aliases
// first, which would capture `name`.
func lookupTableEngine(ctx context.Context, db driver.Conn, database, tableName string) (string, error) {
	query := fmt.Sprintf(
		`SELECT t.engine AS name FROM system.tables AS t WHERE t.database = '%s' AND t.name = '%s'`,
		escapeStringLiteral(database),
		escapeStringLiteral(tableName),
	)
	rows, err := db.Query(ctx, query)
	if err != nil {
		return "", err
	}
	defer func() { _ = rows.Close() }()

	if !rows.Next() {
		return "", rows.Err()
	}

	var engine string
	if err := rows.Scan(&engine); err != nil {
		return "", err
	}

	return engine, rows.Err()
}

func tableExists(ctx context.Context, db driver.Conn, database, tableName string) (bool, error) {
	engine, err := lookupTableEngine(ctx, db, database, tableName)
	return engine != "", err
}

func escapeStringLiteral(s string) string {
	return strings.NewReplacer(`\`, `\\`, `'`, `''`).Replace(s)
}
