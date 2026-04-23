package clickhouseexporter

import (
	"context"
	"testing"
	"time"

	"github.com/everr-labs/chdbexporter/chdbhandle"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.uber.org/zap/zaptest"
)

func TestPushTracesRoundTrip(t *testing.T) {
	t.Cleanup(chdbhandle.ResetForTesting)

	cfg := &Config{
		Path: t.TempDir(),
		TTL:  48 * time.Hour,
	}
	exporter := newTracesExporter(zaptest.NewLogger(t), cfg)
	if err := exporter.start(context.Background(), componenttest.NewNopHost()); err != nil {
		t.Fatal(err)
	}

	traces := ptrace.NewTraces()
	rs := traces.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "unit")
	span := rs.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.SetName("test-span")
	span.SetTraceID(pcommon.TraceID([16]byte{1}))
	span.SetSpanID(pcommon.SpanID([8]byte{2}))
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(time.Now().Add(10 * time.Millisecond)))

	if err := exporter.pushTraceData(context.Background(), traces); err != nil {
		t.Fatalf("push traces: %v", err)
	}

	if got := countRows(t, exporter.handle, cfg.tracesTableName()); got != 1 {
		t.Fatalf("want 1 trace row, got %d", got)
	}
}
