// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zaptest"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/sqltemplates"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

func newRealChDBConn(t *testing.T) driver.Conn {
	t.Cleanup(chdb.ResetForTesting)
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = handle.Close() })

	db, err := internal.NewChDBConn(handle)
	require.NoError(t, err)
	return db
}

func mustExec(t *testing.T, ctx context.Context, db driver.Conn, sql string) {
	t.Helper()
	require.NoError(t, db.Exec(ctx, sql))
}

func cloudNamedConfig() *Config {
	return withDefaultConfig(func(cfg *Config) {
		cfg.LogsTableName = "logs"
		cfg.TracesTableName = "traces"
	})
}

// seedLegacyLogsLayout recreates the pre-rename local schema using the full
// exporter table shape, then removes columns added by startup migrations.
func seedLegacyLogsLayout(t *testing.T, ctx context.Context, db driver.Conn) {
	legacyCfg := withDefaultConfig()
	require.NoError(t, createLogsTable(ctx, legacyCfg, db, zaptest.NewLogger(t)))
	mustExec(t, ctx, db, `ALTER TABLE "default"."otel_logs" DROP COLUMN RowBytes`)
	mustExec(t, ctx, db, `ALTER TABLE "default"."otel_logs" DROP COLUMN TimestampTime`)
	mustExec(t, ctx, db, `ALTER TABLE "default"."otel_logs" DROP COLUMN EventName`)
	mustExec(t, ctx, db,
		`INSERT INTO "default"."otel_logs" (Timestamp, Body) VALUES (now64(9), 'legacy row')`)
	mustExec(t, ctx, db,
		`CREATE VIEW "default"."logs" AS SELECT * FROM "default"."otel_logs"`)
}

func TestAdoptLegacyLogsTablePreservesDataAndAddsRequiredColumns(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	seedLegacyLogsLayout(t, ctx, db)

	// Mirror the exporter start sequence against a real, insert-capable legacy
	// table rather than a reduced fixture that omits required source columns.
	cfg := cloudNamedConfig()
	require.NoError(t, adoptLegacyLogsTable(ctx, cfg, db))
	require.NoError(t, createLogsTable(ctx, cfg, db, zaptest.NewLogger(t)))
	require.NoError(t, migrateLogsTable(ctx, cfg, db))
	require.NoError(t, internal.EnsureRowBytesColumn(
		ctx,
		db,
		cfg.database(),
		cfg.LogsTableName,
		cfg.clusterString(),
		sqltemplates.LogsRowBytesExpression,
	))

	legacyExists, err := tableExists(ctx, db, "default", "otel_logs")
	require.NoError(t, err)
	require.False(t, legacyExists)

	// The legacy data survives under the cloud-facing name and is queryable
	// through the TimestampTime filter the explorer uses.
	rows, err := db.Query(ctx,
		`SELECT Body AS name, toString(RowBytes) AS type FROM "default"."logs" WHERE TimestampTime >= now() - INTERVAL 1 HOUR`)
	require.NoError(t, err)
	require.True(t, rows.Next())
	var body, rowBytes string
	require.NoError(t, rows.Scan(&body, &rowBytes))
	require.Equal(t, "legacy row", body)
	require.NotEqual(t, "0", rowBytes)
	require.NoError(t, rows.Close())

	columns, err := internal.GetTableColumns(ctx, db, "default", "logs")
	require.NoError(t, err)
	require.Contains(t, columns, "TimestampTime")
	require.Contains(t, columns, "EventName")
	require.Contains(t, columns, "RowBytes")
}

func TestCreateTraceTablesUpgradesLegacyLayoutWithRowBytes(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	legacyCfg := withDefaultConfig()
	require.NoError(t, createTraceTables(ctx, legacyCfg, db))
	mustExec(t, ctx, db, `ALTER TABLE "default"."otel_traces" DROP COLUMN RowBytes`)
	mustExec(t, ctx, db,
		`INSERT INTO "default"."otel_traces" (Timestamp, TraceId) VALUES (now64(9), 'trace-1')`)
	mustExec(t, ctx, db,
		`CREATE VIEW "default"."traces" AS SELECT * FROM "default"."otel_traces"`)

	require.NoError(t, createTraceTables(ctx, cloudNamedConfig(), db))

	for _, gone := range []string{"otel_traces", "otel_traces_trace_id_ts", "otel_traces_trace_id_ts_mv"} {
		exists, err := tableExists(ctx, db, "default", gone)
		require.NoError(t, err)
		require.False(t, exists, gone)
	}
	for _, present := range []string{"traces", "traces_trace_id_ts", "traces_trace_id_ts_mv"} {
		exists, err := tableExists(ctx, db, "default", present)
		require.NoError(t, err)
		require.True(t, exists, present)
	}

	rows, err := db.Query(ctx, `SELECT TraceId AS name, toString(RowBytes) AS type FROM "default"."traces"`)
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()
	require.True(t, rows.Next())
	var traceID, rowBytes string
	require.NoError(t, rows.Scan(&traceID, &rowBytes))
	require.Equal(t, "trace-1", traceID)
	require.NotEqual(t, "0", rowBytes)
}

func TestAdoptLegacyLocalTableKeepsCurrentDataWithoutLegacyMarker(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	mustExec(t, ctx, db,
		`CREATE TABLE "default"."logs" (Timestamp DateTime64(9), Body String) ENGINE = MergeTree ORDER BY Timestamp`)
	mustExec(t, ctx, db, `INSERT INTO "default"."logs" VALUES (now64(9), 'current row')`)

	// No legacy table: a restart on the new layout must never touch the
	// current table, or every boot would wipe local telemetry.
	adopted, err := adoptLegacyLocalTable(ctx, db, "default", "otel_logs", "logs")
	require.NoError(t, err)
	require.False(t, adopted)

	rows, err := db.Query(ctx, `SELECT Body AS name FROM "default"."logs"`)
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()
	require.True(t, rows.Next())
}

func TestAdoptLegacyLocalTableNoopWhenNamesMatch(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	mustExec(t, ctx, db,
		`CREATE TABLE "default"."otel_logs" (Timestamp DateTime64(9)) ENGINE = MergeTree ORDER BY Timestamp`)

	adopted, err := adoptLegacyLocalTable(ctx, db, "default", "otel_logs", "otel_logs")
	require.NoError(t, err)
	require.False(t, adopted)

	exists, err := tableExists(ctx, db, "default", "otel_logs")
	require.NoError(t, err)
	require.True(t, exists)
}

func TestAdoptLegacyTraceTablesFinishesInterruptedAdoption(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	// A first boot that died between the two renames: the traces view was
	// dropped and otel_traces renamed, but the legacy MV and companion table
	// were left behind. The next boot must finish the job instead of
	// stranding the companion's data forever.
	mustExec(t, ctx, db,
		`CREATE TABLE "default"."otel_traces" (Timestamp DateTime64(9), TraceId String) ENGINE = MergeTree ORDER BY Timestamp`)
	mustExec(t, ctx, db,
		`CREATE TABLE "default"."otel_traces_trace_id_ts" (TraceId String, Start DateTime64(9)) ENGINE = MergeTree ORDER BY TraceId`)
	mustExec(t, ctx, db,
		`INSERT INTO "default"."otel_traces_trace_id_ts" VALUES ('trace-1', now64(9))`)
	mustExec(t, ctx, db,
		`CREATE MATERIALIZED VIEW "default"."otel_traces_trace_id_ts_mv" TO "default"."otel_traces_trace_id_ts"
		 AS SELECT TraceId, Timestamp AS Start FROM "default"."otel_traces"`)
	mustExec(t, ctx, db,
		`RENAME TABLE "default"."otel_traces" TO "default"."traces"`)

	require.NoError(t, adoptLegacyTraceTables(ctx, cloudNamedConfig(), db))

	for _, gone := range []string{"otel_traces_trace_id_ts", "otel_traces_trace_id_ts_mv"} {
		exists, err := tableExists(ctx, db, "default", gone)
		require.NoError(t, err)
		require.False(t, exists, gone)
	}
	rows, err := db.Query(ctx, `SELECT TraceId AS name FROM "default"."traces_trace_id_ts"`)
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()
	require.True(t, rows.Next(), "companion data must survive the finished adoption")
}

func TestAdoptLegacyLocalTableNeverDropsRealTableUnderCurrentName(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	// A downgraded collector can recreate the legacy table next to an
	// already-adopted real one. Re-upgrading must keep the real table's data
	// rather than dropping it to make room for the rename.
	mustExec(t, ctx, db,
		`CREATE TABLE "default"."otel_logs" (Timestamp DateTime64(9), Body String) ENGINE = MergeTree ORDER BY Timestamp`)
	mustExec(t, ctx, db, `INSERT INTO "default"."otel_logs" VALUES (now64(9), 'downgrade-era row')`)
	mustExec(t, ctx, db,
		`CREATE TABLE "default"."logs" (Timestamp DateTime64(9), Body String) ENGINE = MergeTree ORDER BY Timestamp`)
	mustExec(t, ctx, db, `INSERT INTO "default"."logs" VALUES (now64(9), 'adopted row')`)

	adopted, err := adoptLegacyLocalTable(ctx, db, "default", "otel_logs", "logs")
	require.NoError(t, err)
	require.False(t, adopted)

	rows, err := db.Query(ctx, `SELECT Body AS name FROM "default"."logs"`)
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()
	require.True(t, rows.Next())
	var body string
	require.NoError(t, rows.Scan(&body))
	require.Equal(t, "adopted row", body)
}
