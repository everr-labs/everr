package chdbexporter

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/sqltemplates"
)

func TestTraceLookupRetention(t *testing.T) {
	for _, jsonMode := range []bool{false, true} {
		for _, existing := range []bool{false, true} {
			t.Run(fmt.Sprintf("json=%t/existing=%t", jsonMode, existing), func(t *testing.T) {
				handle := openRealChDB(t)
				cfg := withDefaultConfig(func(c *Config) {
					c.JSON = jsonMode
					c.TracesTableName = "traces"
					c.TTL = 7 * 24 * time.Hour
				})
				conn, err := internal.NewChDBConn(handle)
				require.NoError(t, err)
				if existing {
					require.NoError(t, internal.CreateDatabase(t.Context(), conn, cfg.database(), ""))
					require.NoError(t, ensureLocalSchema(t.Context(), conn, cfg, zap.NewNop()))
					require.NoError(t, conn.Exec(t.Context(), fmt.Sprintf(sqltemplates.TracesCreateTsTable,
						cfg.database(), cfg.TracesTableName, "", cfg.tableEngineString(),
						internal.GenerateTTLExpr(cfg.TTL, "toDateTime(Start)"))))
				}
				data := ptrace.NewTraces()
				resource := data.ResourceSpans().AppendEmpty()
				resource.Resource().Attributes().PutStr("service.name", "trace-retention-test")
				spans := resource.ScopeSpans().AppendEmpty().Spans()
				for i, age := range []time.Duration{8 * 24 * time.Hour, 6 * 24 * time.Hour} {
					span := spans.AppendEmpty()
					span.SetTraceID(pcommon.TraceID{1})
					span.SetSpanID(pcommon.SpanID{byte(i + 1)})
					span.SetStartTimestamp(pcommon.NewTimestampFromTime(time.Now().Add(-age)))
					span.SetEndTimestamp(span.StartTimestamp() + 1_000_000)
				}
				if jsonMode {
					exporter := newTracesJSONExporter(zap.NewNop(), cfg, handle)
					require.NoError(t, exporter.start(t.Context(), nil))
					t.Cleanup(func() { _ = exporter.shutdown(context.Background()) })
					require.NoError(t, exporter.pushTraceData(t.Context(), data))
				} else {
					exporter := newTracesExporter(zap.NewNop(), cfg, handle)
					require.NoError(t, exporter.start(t.Context(), nil))
					t.Cleanup(func() { _ = exporter.shutdown(context.Background()) })
					require.NoError(t, exporter.pushTraceData(t.Context(), data))
				}
				require.NoError(t, conn.Exec(t.Context(), "SET mutations_sync = 2"))
				for _, table := range []string{"traces", "traces_trace_id_ts"} {
					require.NoError(t, conn.Exec(t.Context(), "ALTER TABLE "+table+" MATERIALIZE TTL"))
				}
				var count string
				require.NoError(t, conn.QueryRow(t.Context(), `SELECT toString(count()) AS name FROM traces`).Scan(&count))
				require.Equal(t, "1", count, "the later span must still be retained")
				require.NoError(t, conn.QueryRow(t.Context(), `SELECT toString(count()) AS name FROM traces
					WHERE Timestamp >= (SELECT toDateTime64(min(Start), 9) FROM traces_trace_id_ts)
					AND Timestamp < (SELECT toDateTime64(max(End), 9) + INTERVAL 1 SECOND FROM traces_trace_id_ts)`).Scan(&count))
				require.Equal(t, "1", count, "lookup bounds must outlive the later span")
			})
		}
	}
}
