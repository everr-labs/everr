package clickhouseexporter

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/everr-labs/chdbexporter/chdbhandle"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.uber.org/zap/zaptest"
)

func TestPushLogsRoundTrip(t *testing.T) {
	t.Cleanup(chdbhandle.ResetForTesting)

	cfg := &Config{
		Path: t.TempDir(),
		TTL:  48 * time.Hour,
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

	if got := countRows(t, exporter.handle, cfg.logsTableName()); got != 1 {
		t.Fatalf("want 1 log row, got %d", got)
	}
}

func TestPushLogsTouchesSentinel(t *testing.T) {
	t.Cleanup(chdbhandle.ResetForTesting)

	cfg := &Config{
		Path: t.TempDir(),
		TTL:  48 * time.Hour,
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

	before := time.Now().Add(-time.Second)
	if err := exporter.pushLogsData(context.Background(), logs); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(filepath.Join(cfg.Path, ".last_flush"))
	if err != nil {
		t.Fatalf("sentinel missing: %v", err)
	}
	if info.ModTime().Before(before) {
		t.Fatalf("sentinel mtime %v older than %v", info.ModTime(), before)
	}
}
