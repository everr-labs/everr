// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/exporter/exportertest"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap/zaptest"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metadata"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/sqltemplates"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

// shapedTemplatesDigest pins the DDL that decides the shape of the local
// store. localSchemaVersion has to change with it, because a store built by an
// older binary is only dropped and rebuilt when the version differs.
const shapedTemplatesDigest = "8a3b0fe238fdddb3126980b71856e730da4541a316d34b33a4914a806bc737f7"

func TestSchemaTemplatesMatchVersion(t *testing.T) {
	digest := sha256.New()
	for _, template := range []string{
		sqltemplates.LogsCreateTable,
		sqltemplates.LogsJSONCreateTable,
		sqltemplates.RecordingsCreateTable,
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
	filled := newLogsExporter(zaptest.NewLogger(t), first, newStore(handle))
	require.NoError(t, filled.start(t.Context(), nil))
	ld := plog.NewLogs()
	record := ld.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	record.SetObservedTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	record.Body().SetStr("before")
	require.NoError(t, filled.pushLogsData(t.Context(), ld))
	require.Equal(t, "1", countLogs(first))

	// Apply TTL deletion synchronously so this test cannot pass with an
	// already-expired fixture while background merges happen to be idle.
	require.NoError(t, conn.Exec(t.Context(), `ALTER TABLE "`+first.database()+`"."`+
		first.LogsTableName+`" MATERIALIZE TTL`))
	require.Equal(t, "1", countLogs(first))
	require.NoError(t, filled.shutdown(context.Background()))

	// Roll the marker back to what a binary before this change left behind.
	require.NoError(t, writeSchemaVersion(t.Context(), conn, first.database(), localSchemaVersion-1))

	second := withDefaultConfig()
	rebuilt := newLogsExporter(zaptest.NewLogger(t), second, newStore(handle))
	require.NoError(t, rebuilt.start(t.Context(), nil))
	t.Cleanup(func() { _ = rebuilt.shutdown(context.Background()) })

	require.Equal(t, "0", countLogs(second), "the old rows survived the rebuild")
	version, err := readSchemaVersion(t.Context(), conn, second.database())
	require.NoError(t, err)
	require.Equal(t, localSchemaVersion, version)
}

func TestRebuildCoversEveryComponentOfTheStoreWhicheverStartsFirst(t *testing.T) {
	for _, order := range [][]string{{"first", "second"}, {"second", "first"}} {
		t.Run(strings.Join(order, " then "), func(t *testing.T) {
			handle := openRealChDB(t)
			conn, err := internal.NewChDBConn(handle)
			require.NoError(t, err)

			// A store from an older binary: both components' tables exist
			// with a shape that has none of today's columns.
			tables := map[string]string{"first": "logs", "second": "recordings"}
			for _, table := range tables {
				require.NoError(t, conn.Exec(t.Context(),
					`CREATE TABLE "default"."`+table+`" (old UInt8) ENGINE = MergeTree ORDER BY old`))
			}
			_, err = readSchemaVersion(t.Context(), conn, "default") // creates the marker table
			require.NoError(t, err)
			require.NoError(t, writeSchemaVersion(t.Context(), conn, "default", localSchemaVersion-1))

			factory := NewFactoryWithHandle(handle)
			exporters := map[string]interface {
				Start(context.Context, component.Host) error
				ConsumeLogs(context.Context, plog.Logs) error
				Shutdown(context.Context) error
			}{}
			for name, table := range tables {
				cfg := withDefaultConfig(func(cfg *Config) {
					cfg.JSON = true
					cfg.LogsTableName = table
					if table == "recordings" {
						cfg.LogsLayout = LogsLayoutRecordings
					}
					cfg.QueueSettings = configoptional.None[exporterhelper.QueueBatchConfig]()
				})
				exp, createErr := factory.CreateLogs(t.Context(), exportertest.NewNopSettings(metadata.Type), cfg)
				require.NoError(t, createErr)
				exporters[name] = exp
				t.Cleanup(func() { _ = exp.Shutdown(context.Background()) })
			}

			countRows := func(table string) string {
				rows := queryJSONRows(t, handle, `SELECT toString(count()) AS n FROM "default"."`+table+`"`)
				require.Len(t, rows, 1)
				return rows[0]["n"].(string)
			}

			require.NoError(t, exporters[order[0]].Start(t.Context(), nil))
			ld := plog.NewLogs()
			record := ld.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
			record.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))
			record.Body().SetStr("written between the two starts")
			require.NoError(t, exporters[order[0]].ConsumeLogs(t.Context(), ld))

			require.NoError(t, exporters[order[1]].Start(t.Context(), nil))

			// A second rebuild would have dropped the row the first component
			// wrote before the second one started.
			require.Equal(t, "1", countRows(tables[order[0]]))

			for _, table := range tables {
				columns := queryJSONRows(t, handle,
					`SELECT name FROM system.columns WHERE database = 'default' AND table = '`+table+`'`)
				names := make([]any, 0, len(columns))
				for _, column := range columns {
					names = append(names, column["name"])
				}
				require.Contains(t, names, "Timestamp", "%s kept the shape of the older version", table)
				require.NotContains(t, names, "old", "%s kept the shape of the older version", table)
				if table == "recordings" {
					require.Contains(t, names, "stream_id", "%s was not rebuilt as the recordings layout", table)
				}
			}
			version, err := readSchemaVersion(t.Context(), conn, "default")
			require.NoError(t, err)
			require.Equal(t, localSchemaVersion, version)
		})
	}
}
