// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/stretchr/testify/require"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
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

// seedLegacyLogsLayout recreates the pre-rename local schema: a raw legacy
// table without TimestampTime and a plain view exposing it under the
// cloud-facing name.
func seedLegacyLogsLayout(t *testing.T, ctx context.Context, db driver.Conn) {
	mustExec(t, ctx, db,
		`CREATE TABLE "default"."otel_logs" (Timestamp DateTime64(9), Body String) ENGINE = MergeTree ORDER BY Timestamp`)
	mustExec(t, ctx, db,
		`INSERT INTO "default"."otel_logs" VALUES (now64(9), 'legacy row')`)
	mustExec(t, ctx, db,
		`CREATE VIEW "default"."logs" AS SELECT * FROM "default"."otel_logs"`)
}

func TestAdoptLegacyLogsTablePreservesDataAndAddsTimestampTime(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	seedLegacyLogsLayout(t, ctx, db)

	require.NoError(t, adoptLegacyLogsTable(ctx, cloudNamedConfig(), db))

	legacyExists, err := tableExists(ctx, db, "default", "otel_logs")
	require.NoError(t, err)
	require.False(t, legacyExists)

	// The legacy data survives under the cloud-facing name and is queryable
	// through the TimestampTime filter the explorer uses.
	rows, err := db.Query(ctx,
		`SELECT Body AS name FROM "default"."logs" WHERE TimestampTime >= now() - INTERVAL 1 HOUR`)
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()
	require.True(t, rows.Next())
	var body string
	require.NoError(t, rows.Scan(&body))
	require.Equal(t, "legacy row", body)
}

func TestAdoptLegacyTraceTablesRenamesCompanionsAndDropsMV(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	mustExec(t, ctx, db,
		`CREATE TABLE "default"."otel_traces" (Timestamp DateTime64(9), TraceId String) ENGINE = MergeTree ORDER BY Timestamp`)
	mustExec(t, ctx, db,
		`INSERT INTO "default"."otel_traces" VALUES (now64(9), 'trace-1')`)
	mustExec(t, ctx, db,
		`CREATE TABLE "default"."otel_traces_trace_id_ts" (TraceId String, Start DateTime64(9)) ENGINE = MergeTree ORDER BY TraceId`)
	mustExec(t, ctx, db,
		`CREATE MATERIALIZED VIEW "default"."otel_traces_trace_id_ts_mv" TO "default"."otel_traces_trace_id_ts"
		 AS SELECT TraceId, Timestamp AS Start FROM "default"."otel_traces"`)
	mustExec(t, ctx, db,
		`CREATE VIEW "default"."traces" AS SELECT * FROM "default"."otel_traces"`)

	require.NoError(t, adoptLegacyTraceTables(ctx, cloudNamedConfig(), db))

	for _, gone := range []string{"otel_traces", "otel_traces_trace_id_ts", "otel_traces_trace_id_ts_mv"} {
		exists, err := tableExists(ctx, db, "default", gone)
		require.NoError(t, err)
		require.False(t, exists, gone)
	}
	for _, present := range []string{"traces", "traces_trace_id_ts"} {
		exists, err := tableExists(ctx, db, "default", present)
		require.NoError(t, err)
		require.True(t, exists, present)
	}

	rows, err := db.Query(ctx, `SELECT TraceId AS name FROM "default"."traces"`)
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()
	require.True(t, rows.Next())
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
