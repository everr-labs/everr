package usageprocessor

import (
	"context"
	"errors"
	"testing"

	"github.com/everr-labs/everr/collector/usage"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"go.opentelemetry.io/collector/extension/extensiontest"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

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
	require.NoError(t, p.ConsumeLogs(context.Background(), ld))
	md := meter.Drain()
	require.Equal(t, 2, md.DataPointCount())
	require.Equal(t, int64(2*marshaler.LogsSize(expected)), sum(md))
}

func TestRejectedAdmissionDoesNotCount(t *testing.T) {
	meter := newMeter(t)
	next, err := consumer.NewLogs(func(context.Context, plog.Logs) error { return errors.New("queue persistence failed") })
	require.NoError(t, err)
	p := &metering{meter: meter, logs: next}
	require.Error(t, p.ConsumeLogs(context.Background(), logs("a")))
	require.Zero(t, meter.Drain().DataPointCount())
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
	require.NoError(t, p.ConsumeMetrics(context.Background(), md))
	require.Equal(t, 5, sink.DataPointCount())
	out := meter.Drain()
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
	require.Error(t, p.ConsumeLogs(context.Background(), logs("")))
	require.Zero(t, sink.LogRecordCount())
	ld := logs("a")
	ld.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().RemoveIf(func(plog.LogRecord) bool { return true })
	require.NoError(t, p.ConsumeLogs(context.Background(), ld))
	md := meter.Drain()
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
	require.NoError(t, p.ConsumeTraces(context.Background(), td))
	out := meter.Drain()
	marshaler := ptrace.ProtoMarshaler{}
	require.Equal(t, int64(marshaler.TracesSize(expected)), sum(out))
	require.Equal(t, 1, sink.SpanCount())
}
