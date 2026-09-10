package everrusageprocessor

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/everr-labs/everr/collector/extension/everrusageextension"
	filestorage "github.com/open-telemetry/opentelemetry-collector-contrib/extension/storage/filestorage"
	"github.com/open-telemetry/opentelemetry-collector-contrib/processor/deltatocumulativeprocessor"
	"github.com/stretchr/testify/assert"
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
	"go.opentelemetry.io/collector/processor/processortest"
)

type host map[component.ID]component.Component

func (h host) GetExtensions() map[component.ID]component.Component { return h }

func startHost(t *testing.T, dir string) (host, *everrusageextension.Meter, func()) {
	t.Helper()
	ctx := context.Background()
	uf := everrusageextension.NewFactory()
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
	return h, u.(*everrusageextension.Meter), func() { require.NoError(t, u.Shutdown(ctx)); require.NoError(t, s.Shutdown(ctx)) }
}

func startAdmission(t *testing.T, h host, m *everrusageextension.Meter, signal string, capacity int64, push func(int) error) (func() error, func()) {
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
			r.Resource().Attributes().PutStr(everrusageextension.TenantKey, "a")
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
			r.Resource().Attributes().PutStr(everrusageextension.TenantKey, "a")
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

// The exporter has separate signal queues even when its component ID is shared.
// Logs can be admitted while the metrics queue rejects their usage snapshot.
func TestUsageQueueRejectionRecoveredByLaterSnapshot(t *testing.T) {
	h, meter, stopHost := startHost(t, t.TempDir())
	defer stopHost()
	send, stopLogs := startAdmission(t, h, meter, "logs", 100, func(int) error { return nil })
	defer stopLogs()

	var available atomic.Bool
	var maximum atomic.Int64
	q := exporterhelper.NewDefaultQueueConfig()
	storageID := component.NewIDWithName(component.MustNewType("file_storage"), "ingestion")
	q.StorageID, q.QueueSize, q.NumConsumers = &storageID, 1, 1
	q.WaitForResult = false
	retry := configretry.NewDefaultBackOffConfig()
	retry.InitialInterval, retry.MaxInterval, retry.MaxElapsedTime = time.Millisecond, time.Millisecond, 0
	exp, err := exporterhelper.NewMetrics(t.Context(), exportertest.NewNopSettings(component.MustNewType("storage")), &struct{}{},
		func(_ context.Context, md pmetric.Metrics) error {
			if !available.Load() {
				return errors.New("metrics storage unavailable")
			}
			value := sum(md)
			if value > maximum.Load() {
				maximum.Store(value)
			}
			return nil
		}, exporterhelper.WithQueue(configoptional.Some(q)), exporterhelper.WithRetry(retry))
	require.NoError(t, err)
	require.NoError(t, exp.Start(t.Context(), h))
	defer func() { available.Store(true); require.NoError(t, exp.Shutdown(context.Background())) }()
	factory := deltatocumulativeprocessor.NewFactory()
	cumulative, err := factory.CreateMetrics(t.Context(), processortest.NewNopSettings(factory.Type()), factory.CreateDefaultConfig(), exp)
	require.NoError(t, err)
	require.NoError(t, cumulative.Start(t.Context(), h))
	defer func() { require.NoError(t, cumulative.Shutdown(context.Background())) }()

	require.NoError(t, send())
	first := meter.Drain()
	bytes := sum(first)
	require.Positive(t, bytes)
	require.NoError(t, cumulative.ConsumeMetrics(t.Context(), first))
	require.NoError(t, send(), "logs admission must succeed despite the full metrics queue")
	require.Error(t, cumulative.ConsumeMetrics(t.Context(), meter.Drain()))
	require.Zero(t, meter.Drain().DataPointCount(), "a rejected delta must not be replayed")

	available.Store(true)
	require.Eventually(t, func() bool { return maximum.Load() == bytes }, time.Second, time.Millisecond)
	admissions := int64(2)
	require.EventuallyWithT(t, func(c *assert.CollectT) {
		// Every attempt is a fresh admission, never a replayed delta. This also
		// tolerates the worker still releasing the first queued snapshot.
		require.NoError(c, send())
		admissions++
		require.NoError(c, cumulative.ConsumeMetrics(t.Context(), meter.Drain()))
	}, time.Second, time.Millisecond)
	require.Eventually(t, func() bool { return maximum.Load() == admissions*bytes }, time.Second, time.Millisecond)

}

// Exporter IDs isolate two metrics queues on the same file storage extension.
func TestDedicatedUsageQueueWaitsForCapacity(t *testing.T) {
	h, meter, stopHost := startHost(t, t.TempDir())
	defer stopHost()
	var telemetryAvailable, usageAvailable atomic.Bool
	send, stopTelemetry := startAdmission(t, h, meter, "metrics", 1, func(int) error {
		if !telemetryAvailable.Load() {
			return errors.New("telemetry unavailable")
		}
		return nil
	})
	defer func() { telemetryAvailable.Store(true); stopTelemetry() }()
	require.NoError(t, send())
	require.Error(t, send(), "customer metrics queue is full")
	first := meter.Drain()
	bytes := sum(first)
	require.Positive(t, bytes)

	q := exporterhelper.NewDefaultQueueConfig()
	storageID := component.NewIDWithName(component.MustNewType("file_storage"), "ingestion")
	q.StorageID, q.QueueSize, q.NumConsumers = &storageID, 1, 1
	q.WaitForResult, q.BlockOnOverflow = false, true
	retry := configretry.NewDefaultBackOffConfig()
	retry.InitialInterval, retry.MaxInterval, retry.MaxElapsedTime = time.Millisecond, time.Millisecond, 0
	settings := exportertest.NewNopSettings(component.MustNewType("storage"))
	settings.ID = component.NewIDWithName(component.MustNewType("storage"), "usage")
	var maximum atomic.Int64
	exp, err := exporterhelper.NewMetrics(t.Context(), settings, &struct{}{}, func(_ context.Context, md pmetric.Metrics) error {
		if !usageAvailable.Load() {
			return errors.New("usage unavailable")
		}
		maximum.Store(sum(md))
		return nil
	}, exporterhelper.WithQueue(configoptional.Some(q)), exporterhelper.WithRetry(retry))
	require.NoError(t, err)
	require.NoError(t, exp.Start(t.Context(), h))
	defer func() { usageAvailable.Store(true); require.NoError(t, exp.Shutdown(context.Background())) }()
	factory := deltatocumulativeprocessor.NewFactory()
	cumulative, err := factory.CreateMetrics(t.Context(), processortest.NewNopSettings(factory.Type()), factory.CreateDefaultConfig(), exp)
	require.NoError(t, err)
	require.NoError(t, cumulative.Start(t.Context(), h))
	defer func() { require.NoError(t, cumulative.Shutdown(context.Background())) }()
	require.NoError(t, cumulative.ConsumeMetrics(t.Context(), first), "full customer metrics queue must not prevent usage admission")

	// A full usage queue waits until the publication context expires, rather
	// than immediately rejecting. The failed delta must never be replayed.
	meter.Record("metrics", map[string]int64{"a": bytes})
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	err = cumulative.ConsumeMetrics(ctx, meter.Drain())
	cancel()
	require.ErrorIs(t, err, context.DeadlineExceeded)

	// Freeing usage capacity allows the next cumulative snapshot through even
	// while the customer metrics queue remains full. It includes the failed tail.
	meter.Record("metrics", map[string]int64{"a": bytes})
	usageAvailable.Store(true)
	ctx, cancel = context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	require.NoError(t, cumulative.ConsumeMetrics(ctx, meter.Drain()))
	require.Eventually(t, func() bool { return maximum.Load() == 3*bytes }, time.Second, time.Millisecond)
	require.Error(t, send(), "usage recovery must not depend on draining customer metrics")
}
