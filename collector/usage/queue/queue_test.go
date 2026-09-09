package usagequeue

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/everr-labs/everr/collector/usage"
	filestorage "github.com/open-telemetry/opentelemetry-collector-contrib/extension/storage/filestorage"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/connector/connectortest"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/extension/extensiontest"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/pdata/xpdata/pref"
)

type host map[component.ID]component.Component

func (h host) GetExtensions() map[component.ID]component.Component { return h }

func startHost(t *testing.T, dir string) (host, *usage.Meter, func()) {
	t.Helper()
	ctx := context.Background()
	uf := usage.NewFactory()
	u, err := uf.Create(ctx, extensiontest.NewNopSettings(uf.Type()), uf.CreateDefaultConfig())
	require.NoError(t, err)
	sf := filestorage.NewFactory()
	sc := sf.CreateDefaultConfig().(*filestorage.Config)
	sc.Directory = dir
	sc.FSync = true
	storageID := component.NewIDWithName(sf.Type(), "ingestion")
	set := extensiontest.NewNopSettings(sf.Type())
	set.ID = storageID
	s, err := sf.Create(ctx, set, sc)
	require.NoError(t, err)
	h := host{storageID: s, component.NewID(uf.Type()): u}
	require.NoError(t, s.Start(ctx, h))
	require.NoError(t, u.Start(ctx, h))
	return h, u.(*usage.Meter), func() { require.NoError(t, u.Shutdown(ctx)); require.NoError(t, s.Shutdown(ctx)) }
}

func startQueue(t *testing.T, h host, signal string, push func(context.Context) error) (func() error, func()) {
	t.Helper()
	f := NewFactory()
	cfg := f.CreateDefaultConfig().(*Config)
	cfg.Queue.Get().Batch.Get().MinSize = 100
	cfg.Queue.Get().Batch.Get().FlushTimeout = 20 * time.Millisecond
	cfg.Retry.InitialInterval = time.Millisecond
	cfg.Retry.MaxInterval = time.Millisecond
	require.NoError(t, cfg.Validate())
	set := connectortest.NewNopSettings(f.Type())
	set.ID = component.NewID(f.Type())
	var c component.Component
	var send func() error
	var err error
	switch signal {
	case "logs":
		next, e := consumer.NewLogs(func(ctx context.Context, ld plog.Logs) error {
			if pref.MarkPipelineOwnedLogs(ld) {
				defer pref.UnrefLogs(ld)
			}
			require.Equal(t, "a", ld.ResourceLogs().At(0).Resource().Attributes().AsRaw()[usage.TenantKey])
			ld.ResourceLogs().At(0).Resource().Attributes().PutStr(usage.TenantKey, "mutated")
			return push(ctx)
		})
		require.NoError(t, e)
		q, e := f.CreateLogsToLogs(context.Background(), set, cfg, next)
		err = e
		c = q
		send = func() error {
			ld := plog.NewLogs()
			rm := ld.ResourceLogs().AppendEmpty()
			rm.Resource().Attributes().PutStr(usage.TenantKey, "a")
			rm.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty().Body().SetStr("persist me")
			return q.ConsumeLogs(context.Background(), ld)
		}
	case "traces":
		next, e := consumer.NewTraces(func(ctx context.Context, td ptrace.Traces) error {
			if pref.MarkPipelineOwnedTraces(td) {
				defer pref.UnrefTraces(td)
			}
			require.Equal(t, "a", td.ResourceSpans().At(0).Resource().Attributes().AsRaw()[usage.TenantKey])
			td.ResourceSpans().At(0).Resource().Attributes().PutStr(usage.TenantKey, "mutated")
			return push(ctx)
		})
		require.NoError(t, e)
		q, e := f.CreateTracesToTraces(context.Background(), set, cfg, next)
		err = e
		c = q
		send = func() error {
			td := ptrace.NewTraces()
			rm := td.ResourceSpans().AppendEmpty()
			rm.Resource().Attributes().PutStr(usage.TenantKey, "a")
			rm.ScopeSpans().AppendEmpty().Spans().AppendEmpty().SetName("persist me")
			return q.ConsumeTraces(context.Background(), td)
		}
	case "metrics":
		next, e := consumer.NewMetrics(func(ctx context.Context, md pmetric.Metrics) error {
			if pref.MarkPipelineOwnedMetrics(md) {
				defer pref.UnrefMetrics(md)
			}
			require.Equal(t, "a", md.ResourceMetrics().At(0).Resource().Attributes().AsRaw()[usage.TenantKey])
			md.ResourceMetrics().At(0).Resource().Attributes().PutStr(usage.TenantKey, "mutated")
			return push(ctx)
		})
		require.NoError(t, e)
		q, e := f.CreateMetricsToMetrics(context.Background(), set, cfg, next)
		err = e
		c = q
		send = func() error {
			md := pmetric.NewMetrics()
			rm := md.ResourceMetrics().AppendEmpty()
			rm.Resource().Attributes().PutStr(usage.TenantKey, "a")
			rm.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty().SetEmptyGauge().DataPoints().AppendEmpty().SetIntValue(1)
			return q.ConsumeMetrics(context.Background(), md)
		}
	}
	require.NoError(t, err)
	require.NoError(t, c.Start(context.Background(), h))
	return send, func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		require.NoError(t, c.Shutdown(ctx))
	}
}

func TestPersistentRecovery(t *testing.T) {
	for _, signal := range []string{"logs", "traces", "metrics"} {
		t.Run(signal, func(t *testing.T) {
			dir := t.TempDir()
			h, m, stopHost := startHost(t, dir)
			var attempts atomic.Int32
			send, stop := startQueue(t, h, signal, func(context.Context) error { attempts.Add(1); return errors.New("storage unavailable") })
			require.NoError(t, send(), "durable admission should not wait for storage availability")
			require.Eventually(t, func() bool { return attempts.Load() > 1 }, time.Second, time.Millisecond)
			// Simulate the worst billing window: usage was published before a crash left
			// the queue entry pending. Replay must not charge this entry a second time.
			m.Record(signal, map[string]int64{"a": 100})
			first := m.Drain()
			require.Equal(t, 1, first.DataPointCount())
			stop()
			stopHost()

			h, m, stopHost = startHost(t, dir)
			var delivered atomic.Int32
			send, stop = startQueue(t, h, signal, func(ctx context.Context) error {
				m.RecordConfirmed(ctx, signal, map[string]int64{"a": 100})
				delivered.Add(1)
				return nil
			})
			// Submit before the replay batch flushes to exercise epoch-based partitioning.
			require.NoError(t, send())
			require.Eventually(t, func() bool { return delivered.Load() == 2 }, time.Second, time.Millisecond)
			out := m.Drain()
			require.Equal(t, 1, out.DataPointCount())
			require.Equal(t, int64(100), out.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0).IntValue())
			stop()
			stopHost()

			h, _, stopHost = startHost(t, dir)
			var unexpected atomic.Int32
			_, stop = startQueue(t, h, signal, func(context.Context) error { unexpected.Add(1); return nil })
			stop()
			stopHost()
			require.Zero(t, unexpected.Load(), "successfully exported entries must have been removed")
		})
	}
}

func TestQueueConfigRequiresDurability(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*Config)
	}{
		{"no_storage", func(c *Config) { c.Queue.Get().StorageID = nil }},
		{"wait_for_result", func(c *Config) { c.Queue.Get().WaitForResult = true }},
		{"finite_retries", func(c *Config) { c.Retry.MaxElapsedTime = time.Minute }},
		{"no_retries", func(c *Config) { c.Retry.Enabled = false }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := NewFactory().CreateDefaultConfig().(*Config)
			tc.change(c)
			require.Error(t, c.Validate())
		})
	}
}
