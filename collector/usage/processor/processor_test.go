package usageprocessor

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/everr-labs/everr/collector/usage"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/config/configretry"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/exporter/exportertest"
	"go.opentelemetry.io/collector/extension/extensiontest"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

type testHost struct{ extension component.Component }

func (h testHost) GetExtensions() map[component.ID]component.Component {
	return map[component.ID]component.Component{component.NewID(component.MustNewType(usage.Type)): h.extension}
}
func newMeter(t *testing.T) *usage.Meter {
	t.Helper()
	f := usage.NewFactory()
	e, err := f.Create(context.Background(), extensiontest.NewNopSettings(f.Type()), f.CreateDefaultConfig())
	require.NoError(t, err)
	return e.(*usage.Meter)
}
func logs(tenant string) plog.Logs {
	ld := plog.NewLogs()
	rm := ld.ResourceLogs().AppendEmpty()
	rm.Resource().Attributes().PutStr(usage.TenantKey, tenant)
	rm.Resource().Attributes().PutStr(usage.RetentionKey, "14")
	rm.Resource().Attributes().PutStr("service.name", "customer-app")
	rm.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty().Body().SetStr("hello")
	return ld
}
func sum(md pmetric.Metrics) int64 {
	var n int64
	for _, rm := range md.ResourceMetrics().All() {
		n += rm.ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0).IntValue()
	}
	return n
}

func TestLogsMeasuredBeforeDownstreamMutation(t *testing.T) {
	meter := newMeter(t)
	ld := logs("a")
	logs("b").ResourceLogs().At(0).CopyTo(ld.ResourceLogs().AppendEmpty())
	expected := logs("a")
	stripRouting(expected.ResourceLogs().At(0).Resource())
	marshaler := plog.ProtoMarshaler{}
	next, err := consumer.NewLogs(func(_ context.Context, data plog.Logs) error {
		require.Equal(t, 2, data.LogRecordCount())
		require.Equal(t, "14", data.ResourceLogs().At(0).Resource().Attributes().AsRaw()[usage.RetentionKey])
		data.ResourceLogs().RemoveIf(func(plog.ResourceLogs) bool { return true })
		return nil
	}, consumer.WithCapabilities(consumer.Capabilities{MutatesData: true}))
	require.NoError(t, err)
	p := &metering{meter: meter, logs: next}
	require.NoError(t, p.ConsumeLogs(meter.MarkEnqueued(context.Background()), ld))
	md, _ := meter.Drain()
	require.Equal(t, 2, md.DataPointCount())
	require.Equal(t, int64(2*marshaler.LogsSize(expected)), sum(md))
}

func TestExporterQueueAndRetries(t *testing.T) {
	for _, tc := range []struct {
		name        string
		fail, retry bool
		wantCalls   int32
		wantUsage   bool
	}{
		{name: "success", wantCalls: 1, wantUsage: true}, {name: "ambiguous_failure", fail: true, wantCalls: 1},
		{name: "retry_success", fail: true, retry: true, wantCalls: 2, wantUsage: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			meter := newMeter(t)
			var calls atomic.Int32
			q := exporterhelper.NewDefaultQueueConfig()
			q.WaitForResult = true
			batch := q.Batch.GetOrInsertDefault()
			batch.MinSize = 100
			batch.FlushTimeout = 5 * time.Millisecond
			r := configretry.NewDefaultBackOffConfig()
			r.Enabled = tc.retry
			r.InitialInterval = time.Millisecond
			r.MaxInterval = time.Millisecond
			r.MaxElapsedTime = time.Second
			exp, err := exporterhelper.NewLogs(context.Background(), exportertest.NewNopSettings(component.MustNewType("storage")), &struct{}{}, func(context.Context, plog.Logs) error {
				if calls.Add(1) == 1 && tc.fail {
					return errors.New("ambiguous storage failure")
				}
				return nil
			}, exporterhelper.WithQueue(configoptional.Some(q)), exporterhelper.WithRetry(r))
			require.NoError(t, err)
			host := testHost{meter}
			require.NoError(t, exp.Start(context.Background(), host))
			defer func() { require.NoError(t, exp.Shutdown(context.Background())) }()
			p := &metering{meter: meter, logs: exp}
			err = p.ConsumeLogs(meter.MarkEnqueued(context.Background()), logs("a"))
			if tc.wantUsage {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
			md, _ := meter.Drain()
			require.Equal(t, tc.wantUsage, md.DataPointCount() > 0)
			require.Equal(t, tc.wantCalls, calls.Load())
		})
	}
}

func TestMetricsKindsAndSpoofing(t *testing.T) {
	meter := newMeter(t)
	sink := &consumertest.MetricsSink{}
	p := &metering{meter: meter, metrics: sink}
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr(usage.TenantKey, "a")
	sm := rm.ScopeMetrics().AppendEmpty()
	sm.Metrics().AppendEmpty().SetEmptyGauge().DataPoints().AppendEmpty().SetIntValue(1)
	sm.Metrics().AppendEmpty().SetEmptySum().DataPoints().AppendEmpty().SetIntValue(2)
	sm.Metrics().AppendEmpty().SetEmptyHistogram().DataPoints().AppendEmpty().SetCount(1000)
	sm.Metrics().AppendEmpty().SetEmptyExponentialHistogram().DataPoints().AppendEmpty().SetCount(2000)
	sm.Metrics().AppendEmpty().SetEmptySummary().DataPoints().AppendEmpty().SetCount(3000)
	empty := sm.Metrics().AppendEmpty()
	empty.SetName("empty")
	empty.SetEmptyGauge()
	spoof := sm.Metrics().AppendEmpty()
	spoof.SetName(usage.MetricName)
	spoof.SetEmptySum().DataPoints().AppendEmpty().SetIntValue(999999)
	require.NoError(t, p.ConsumeMetrics(meter.MarkEnqueued(context.Background()), md))
	require.Equal(t, 5, sink.DataPointCount())
	out, _ := meter.Drain()
	require.Equal(t, 1, out.DataPointCount())
	expected := pmetric.NewMetrics()
	sink.AllMetrics()[0].CopyTo(expected)
	stripRouting(expected.ResourceMetrics().At(0).Resource())
	expected.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().RemoveIf(func(m pmetric.Metric) bool { return points(m) == 0 })
	marshaler := pmetric.ProtoMarshaler{}
	require.Equal(t, int64(marshaler.MetricsSize(expected)), sum(out))
}

func TestEmptyAndMissingTenant(t *testing.T) {
	meter := newMeter(t)
	sink := &consumertest.LogsSink{}
	p := &metering{meter: meter, logs: sink}
	require.Error(t, p.ConsumeLogs(meter.MarkEnqueued(context.Background()), logs("")))
	require.Zero(t, sink.LogRecordCount())
	ld := logs("a")
	ld.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().RemoveIf(func(plog.LogRecord) bool { return true })
	require.NoError(t, p.ConsumeLogs(meter.MarkEnqueued(context.Background()), ld))
	md, _ := meter.Drain()
	require.Zero(t, md.DataPointCount())
}

func TestTraces(t *testing.T) {
	meter := newMeter(t)
	sink := &consumertest.TracesSink{}
	p := &metering{meter: meter, traces: sink}
	td := ptrace.NewTraces()
	rm := td.ResourceSpans().AppendEmpty()
	rm.Resource().Attributes().PutStr(usage.TenantKey, "a")
	rm.ScopeSpans().AppendEmpty().Spans().AppendEmpty().SetName("span")
	expected := ptrace.NewTraces()
	td.CopyTo(expected)
	stripRouting(expected.ResourceSpans().At(0).Resource())
	require.NoError(t, p.ConsumeTraces(meter.MarkEnqueued(context.Background()), td))
	out, _ := meter.Drain()
	marshaler := ptrace.ProtoMarshaler{}
	require.Equal(t, int64(marshaler.TracesSize(expected)), sum(out))
	require.Equal(t, 1, sink.SpanCount())
}

func TestSplitFailureDoesNotBillWholeRequest(t *testing.T) {
	meter := newMeter(t)
	var calls atomic.Int32
	q := exporterhelper.NewDefaultQueueConfig()
	q.WaitForResult = true
	q.NumConsumers = 1
	batch := q.Batch.GetOrInsertDefault()
	batch.MinSize = 1
	batch.MaxSize = 1
	exp, err := exporterhelper.NewLogs(context.Background(), exportertest.NewNopSettings(component.MustNewType("storage")), &struct{}{}, func(context.Context, plog.Logs) error {
		if calls.Add(1) == 1 {
			return errors.New("first chunk failed")
		}
		return nil
	}, exporterhelper.WithQueue(configoptional.Some(q)))
	require.NoError(t, err)
	require.NoError(t, exp.Start(context.Background(), testHost{meter}))
	defer func() { require.NoError(t, exp.Shutdown(context.Background())) }()
	ld := logs("a")
	ld.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().AppendEmpty().Body().SetStr("second record")
	p := &metering{meter: meter, logs: exp}
	require.Error(t, p.ConsumeLogs(meter.MarkEnqueued(context.Background()), ld))
	require.Equal(t, int32(2), calls.Load())
	md, _ := meter.Drain()
	require.Zero(t, md.DataPointCount())
}
