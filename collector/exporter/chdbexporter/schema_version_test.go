// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap/zaptest"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/sqltemplates"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

// shapedTemplatesDigest pins the DDL that decides the shape of the local
// store. localSchemaVersion has to change with it, because a store built by an
// older binary is only dropped and rebuilt when the version differs.
const shapedTemplatesDigest = "5f3208d951a57385daa401a3c0cda687f09e664c1e062678651bcf0ba897d63e"

func TestSchemaTemplatesMatchVersion(t *testing.T) {
	digest := sha256.New()
	for _, template := range []string{
		sqltemplates.LogsCreateTable,
		sqltemplates.LogsJSONCreateTable,
		sqltemplates.TracesCreateTable,
		sqltemplates.TracesJSONCreateTable,
		sqltemplates.TracesCreateTsTable,
		sqltemplates.TracesCreateTsView,
		sqltemplates.ProfilesCreateTable,
		sqltemplates.MetricsGaugeCreateTable,
		sqltemplates.MetricsSumCreateTable,
		sqltemplates.MetricsHistogramCreateTable,
		sqltemplates.MetricsExpHistogramCreateTable,
		sqltemplates.MetricsSummaryCreateTable,
	} {
		digest.Write([]byte(template))
	}

	require.Equal(t, shapedTemplatesDigest, hex.EncodeToString(digest.Sum(nil)),
		"a table's DDL changed: bump localSchemaVersion so existing stores rebuild, "+
			"then update shapedTemplatesDigest to the value above")
}

func TestRebuildDropsTablesOfEveryLayout(t *testing.T) {
	cfg := withDefaultConfig(func(cfg *Config) {
		cfg.LogsTableName = "logs"
		cfg.TracesTableName = "traces"
		cfg.MetricsTables.Gauge.Name = "metrics_gauge"
	})

	names := staleTableNames(cfg)

	// The names this config writes to.
	require.Subset(t, names, []string{"logs", "traces", "metrics_gauge"})
	// The names a store from before the rename still holds. Nothing else drops
	// them once the store stops writing to them.
	require.Subset(t, names, []string{"otel_logs", "otel_traces", "otel_metrics_gauge"})
	// The trace-id lookup table and the view that feeds it.
	require.Subset(t, names, []string{"traces_trace_id_ts", "traces_trace_id_ts_mv"})
}

func TestRebuildDropsViewsBeforeTheirTables(t *testing.T) {
	cfg := withDefaultConfig(func(cfg *Config) { cfg.TracesTableName = "traces" })

	names := staleTableNames(cfg)
	view := slices.Index(names, "traces_trace_id_ts_mv")
	target := slices.Index(names, "traces_trace_id_ts")
	source := slices.Index(names, "traces")

	require.Less(t, view, target, "the view must be dropped before the table it writes")
	require.Less(t, view, source, "the view must be dropped before the table it reads")
}

func TestRebuildDropsEachTableOnce(t *testing.T) {
	// The default config already names its tables otel_*, so the configured
	// names and the legacy ones are the same list.
	names := staleTableNames(withDefaultConfig())

	seen := map[string]bool{}
	for _, name := range names {
		require.False(t, seen[name], "%s is dropped twice", name)
		seen[name] = true
	}
}

// The fakes above prove which statements run. This one runs them against a
// real chDB store, which is the only place the shim quirks in readSchemaVersion
// and writeSchemaVersion show up.
func TestRebuildEmptiesAStoreBuiltAtAnOlderVersion(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = handle.Close() })

	conn, err := internal.NewChDBConn(handle)
	require.NoError(t, err)

	countLogs := func(cfg *Config) string {
		// `AS name` and a string, for the same reason readSchemaVersion needs them.
		rows, queryErr := conn.Query(t.Context(), `SELECT toString(count()) AS name FROM "`+
			cfg.database()+`"."`+cfg.LogsTableName+`"`)
		require.NoError(t, queryErr)
		defer func() { _ = rows.Close() }()
		require.True(t, rows.Next())
		var count string
		require.NoError(t, rows.Scan(&count))
		return count
	}

	// A store filled by an earlier run.
	first := withDefaultConfig()
	filled := newLogsExporter(zaptest.NewLogger(t), first, handle)
	require.NoError(t, filled.start(t.Context(), nil))
	ld := plog.NewLogs()
	ld.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty().Body().SetStr("before")
	require.NoError(t, filled.pushLogsData(t.Context(), ld))
	require.Equal(t, "1", countLogs(first))
	require.NoError(t, filled.shutdown(context.Background()))

	// Roll the marker back to what a binary before this change left behind.
	require.NoError(t, writeSchemaVersion(t.Context(), conn, first.database(), localSchemaVersion-1))

	second := withDefaultConfig()
	rebuilt := newLogsExporter(zaptest.NewLogger(t), second, handle)
	require.NoError(t, rebuilt.start(t.Context(), nil))
	t.Cleanup(func() { _ = rebuilt.shutdown(context.Background()) })

	require.Equal(t, "0", countLogs(second), "the old rows survived the rebuild")
	version, err := readSchemaVersion(t.Context(), conn, second.database())
	require.NoError(t, err)
	require.Equal(t, localSchemaVersion, version)
}
