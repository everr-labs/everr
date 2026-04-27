package clickhouseexporter

import (
	"context"
	"testing"
	"time"

	"github.com/everr-labs/chdbexporter/chdbhandle"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap/zaptest"
)

func TestTableNameOverrideRoutesToCustomTable(t *testing.T) {
	t.Cleanup(chdbhandle.ResetForTesting)

	cfg := &Config{
		Path: t.TempDir(),
		TTL:  48 * time.Hour,
		TableNames: TableNames{
			Logs: "custom_logs",
		},
	}
	exporter := newLogsExporter(zaptest.NewLogger(t), cfg)
	if err := exporter.start(context.Background(), componenttest.NewNopHost()); err != nil {
		t.Fatal(err)
	}

	logs := plog.NewLogs()
	rl := logs.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", "unit")
	record := rl.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	record.Body().SetStr("hello")
	record.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))

	if err := exporter.pushLogsData(context.Background(), logs); err != nil {
		t.Fatalf("push logs: %v", err)
	}

	if got := countRows(t, exporter.handle, "custom_logs"); got != 1 {
		t.Fatalf("want 1 custom log row, got %d", got)
	}
}
