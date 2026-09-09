package usageprocessor

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
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/config/configretry"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/exporter/exportertest"
	"go.opentelemetry.io/collector/extension/extensiontest"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
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

func startAdmission(t *testing.T, h host, m *usage.Meter, signal string, capacity int64, push func(int) error) (func() error, func()) {
	t.Helper()
	ctx := context.Background()
	q := exporterhelper.NewDefaultQueueConfig()
	id := component.NewIDWithName(component.MustNewType("file_storage"), "ingestion")
	q.StorageID = &id
	q.QueueSize = capacity
	q.NumConsumers = 1
	q.WaitForResult = false
	q.Batch.GetOrInsertDefault().MinSize = 100
	q.Batch.Get().FlushTimeout = 20 * time.Millisecond
	retry := configretry.NewDefaultBackOffConfig()
	retry.InitialInterval = time.Millisecond
	retry.MaxInterval = time.Millisecond
	retry.MaxElapsedTime = 0
	opts := []exporterhelper.Option{exporterhelper.WithQueue(configoptional.Some(q)), exporterhelper.WithRetry(retry)}
	set := exportertest.NewNopSettings(component.MustNewType("storage"))
	set.ID = component.NewID(component.MustNewType("storage"))
	var exp component.Component
	var send func() error
	switch signal {
	case "logs":
		e, err := exporterhelper.NewLogs(ctx, set, &struct{}{}, func(_ context.Context, d plog.Logs) error { return push(d.LogRecordCount()) }, opts...)
		require.NoError(t, err)
		exp = e
		p := &metering{meter: m, logs: e}
		send = func() error { return p.ConsumeLogs(ctx, logs("a")) }
	case "traces":
		e, err := exporterhelper.NewTraces(ctx, set, &struct{}{}, func(_ context.Context, d ptrace.Traces) error { return push(d.SpanCount()) }, opts...)
		require.NoError(t, err)
		exp = e
		p := &metering{meter: m, traces: e}
		send = func() error {
			d := ptrace.NewTraces()
			r := d.ResourceSpans().AppendEmpty()
			r.Resource().Attributes().PutStr(usage.TenantKey, "a")
			r.ScopeSpans().AppendEmpty().Spans().AppendEmpty().SetName("persist me")
			return p.ConsumeTraces(ctx, d)
		}
	case "metrics":
		e, err := exporterhelper.NewMetrics(ctx, set, &struct{}{}, func(_ context.Context, d pmetric.Metrics) error { return push(d.DataPointCount()) }, opts...)
		require.NoError(t, err)
		exp = e
		p := &metering{meter: m, metrics: e}
		send = func() error {
			d := pmetric.NewMetrics()
			r := d.ResourceMetrics().AppendEmpty()
			r.Resource().Attributes().PutStr(usage.TenantKey, "a")
			metric := r.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
			metric.SetName("test")
			metric.SetEmptyGauge().DataPoints().AppendEmpty().SetIntValue(1)
			return p.ConsumeMetrics(ctx, d)
		}
	}
	require.NoError(t, exp.Start(ctx, h))
	return send, func() {
		ctx, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		require.NoError(t, exp.Shutdown(ctx))
	}
}

func TestPersistentAdmissionRecovery(t *testing.T) {
	for _, signal := range []string{"logs", "traces", "metrics"} {
		t.Run(signal, func(t *testing.T) {
			dir := t.TempDir()
			h, m, stopHost := startHost(t, dir)
			var attempts atomic.Int32
			send, stop := startAdmission(t, h, m, signal, 100, func(int) error { attempts.Add(1); return errors.New("storage unavailable") })
			require.NoError(t, send())
			first := sum(m.Drain())
			require.Positive(t, first, "durable admission counts before storage success")
			require.Eventually(t, func() bool { return attempts.Load() > 1 }, time.Second, time.Millisecond)
			require.Zero(t, m.Drain().DataPointCount(), "storage retries never revisit admission accounting")
			stop()
			stopHost()
			h, m, stopHost = startHost(t, dir)
			var delivered atomic.Int32
			send, stop = startAdmission(t, h, m, signal, 100, func(n int) error { delivered.Add(int32(n)); return nil })
			require.Eventually(t, func() bool { return delivered.Load() == 1 }, time.Second, time.Millisecond)
			require.Zero(t, m.Drain().DataPointCount(), "recovered data must not be charged again")
			require.NoError(t, send())
			require.Equal(t, first, sum(m.Drain()))
			require.Eventually(t, func() bool { return delivered.Load() == 2 }, time.Second, time.Millisecond)
			stop()
			stopHost()
		})
	}
}

func TestFullQueueRejectsWithoutUsage(t *testing.T) {
	for _, signal := range []string{"logs", "traces", "metrics"} {
		t.Run(signal, func(t *testing.T) {
			h, m, stopHost := startHost(t, t.TempDir())
			defer stopHost()
			var available atomic.Bool
			send, stop := startAdmission(t, h, m, signal, 1, func(int) error {
				if !available.Load() {
					return errors.New("storage unavailable")
				}
				return nil
			})
			defer stop()
			require.NoError(t, send())
			require.Positive(t, sum(m.Drain()))
			err := send()
			available.Store(true)
			require.Error(t, err)
			require.Zero(t, m.Drain().DataPointCount())
		})
	}
}
