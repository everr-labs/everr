package chdbexporter

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/exporter/exportertest"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/chdbtest"
)

var (
	sentAt    = time.Date(2026, 1, 2, 3, 4, 5, 123456789, time.UTC)
	startedAt = sentAt.Add(-90 * time.Second)
)

const (
	sentAtText    = `"2026-01-02T03:04:05.123456789Z"`
	startedAtText = `"2026-01-02T03:02:35.123456789Z"`
)

func newExporters(t *testing.T) (exporter.Factory, *Config, *chdbtest.Session) {
	t.Helper()
	handle, session := chdbtest.Open(t)
	factory := NewFactory(handle)
	cfg := factory.CreateDefaultConfig().(*Config)
	cfg.RetentionDays = 7
	cfg.QueueSettings = configoptional.None[exporterhelper.QueueBatchConfig]()
	cfg.BackOffConfig.Enabled = false
	return factory, cfg, session
}

func TestConfigNeedsRetentionDays(t *testing.T) {
	factory, _, _ := newExporters(t)
	cfg := factory.CreateDefaultConfig()
	require.NoError(t, componenttest.CheckConfigStruct(cfg))
	require.ErrorContains(t, confmap.Validate(cfg), "retention_days")

	conf := confmap.NewFromStringMap(map[string]any{"retention_days": 30})
	require.NoError(t, conf.Unmarshal(cfg))
	require.NoError(t, confmap.Validate(cfg))
	require.EqualValues(t, 30, cfg.(*Config).RetentionDays)
}

func TestLogsAreWrittenToTheLandingTableWithTheRetentionStamp(t *testing.T) {
	factory, cfg, session := newExporters(t)
	exp, err := factory.CreateLogs(t.Context(), exportertest.NewNopSettings(factory.Type()), cfg)
	require.NoError(t, err)
	require.True(t, exp.Capabilities().MutatesData, "the stamp is written into the resource it was given")
	require.NoError(t, exp.Start(t.Context(), componenttest.NewNopHost()))
	t.Cleanup(func() { _ = exp.Shutdown(t.Context()) })

	ld := plog.NewLogs()
	resourceLogs := ld.ResourceLogs().AppendEmpty()
	resourceLogs.SetSchemaUrl("resource-url")
	resourceLogs.Resource().Attributes().PutStr("service.name", "checkout")
	resourceLogs.Resource().Attributes().PutInt("everr.retention.days", 0)
	scopeLogs := resourceLogs.ScopeLogs().AppendEmpty()
	scopeLogs.SetSchemaUrl("scope-url")
	scopeLogs.Scope().SetName("scope")
	scopeLogs.Scope().SetVersion("1.2.3")
	scopeLogs.Scope().Attributes().PutBool("scope.flag", true)
	record := scopeLogs.LogRecords().AppendEmpty()
	record.SetTimestamp(pcommon.NewTimestampFromTime(sentAt))
	record.SetTraceID(pcommon.TraceID{1})
	record.SetSpanID(pcommon.SpanID{2})
	record.SetFlags(plog.DefaultLogRecordFlags.WithIsSampled(true))
	record.SetSeverityText("INFO")
	record.SetSeverityNumber(plog.SeverityNumberInfo)
	record.SetEventName("order.placed")
	record.Body().SetStr("hello")
	record.Attributes().PutInt("attempt", 3)
	record.Attributes().PutStr("http.route", "/x")
	observed := scopeLogs.LogRecords().AppendEmpty()
	observed.SetObservedTimestamp(pcommon.NewTimestampFromTime(startedAt))
	observed.Body().SetStr("no event time")

	require.NoError(t, exp.ConsumeLogs(t.Context(), ld))

	require.Equal(t, []string{
		"INSERT INTO otel.otel_logs SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow\n" +
			`{"Timestamp":` + sentAtText + `,"TraceId":"01000000000000000000000000000000","SpanId":"0200000000000000","TraceFlags":1,"SeverityText":"INFO","SeverityNumber":9,"ServiceName":"checkout","Body":"hello","ResourceSchemaUrl":"resource-url","ResourceAttributes":{"everr.retention.days":"7","service.name":"checkout"},"ScopeSchemaUrl":"scope-url","ScopeName":"scope","ScopeVersion":"1.2.3","ScopeAttributes":{"scope.flag":true},"LogAttributes":{"attempt":3,"http.route":"/x"},"ResourceAttributesKeys":["everr.retention.days","service.name"],"ScopeAttributesKeys":["scope.flag"],"LogAttributesKeys":["attempt","http.route"],"EventName":"order.placed"}` + "\n" +
			`{"Timestamp":` + startedAtText + `,"TraceId":"","SpanId":"","TraceFlags":0,"SeverityText":"","SeverityNumber":0,"ServiceName":"checkout","Body":"no event time","ResourceSchemaUrl":"resource-url","ResourceAttributes":{"everr.retention.days":"7","service.name":"checkout"},"ScopeSchemaUrl":"scope-url","ScopeName":"scope","ScopeVersion":"1.2.3","ScopeAttributes":{"scope.flag":true},"LogAttributes":{},"ResourceAttributesKeys":["everr.retention.days","service.name"],"ScopeAttributesKeys":["scope.flag"],"LogAttributesKeys":null,"EventName":""}` + "\n",
	}, session.Statements())
}

func TestTracesAreWrittenToTheLandingTableWithEventsAndLinks(t *testing.T) {
	factory, cfg, session := newExporters(t)
	exp, err := factory.CreateTraces(t.Context(), exportertest.NewNopSettings(factory.Type()), cfg)
	require.NoError(t, err)
	require.True(t, exp.Capabilities().MutatesData)
	require.NoError(t, exp.Start(t.Context(), componenttest.NewNopHost()))
	t.Cleanup(func() { _ = exp.Shutdown(t.Context()) })

	td := ptrace.NewTraces()
	resourceSpans := td.ResourceSpans().AppendEmpty()
	resourceSpans.Resource().Attributes().PutStr("service.name", "checkout")
	scopeSpans := resourceSpans.ScopeSpans().AppendEmpty()
	scopeSpans.Scope().SetName("scope")
	scopeSpans.Scope().SetVersion("1.2.3")
	span := scopeSpans.Spans().AppendEmpty()
	span.SetTraceID(pcommon.TraceID{1})
	span.SetSpanID(pcommon.SpanID{2})
	span.SetParentSpanID(pcommon.SpanID{3})
	span.TraceState().FromRaw("vendor=1")
	span.SetName("POST /orders")
	span.SetKind(ptrace.SpanKindServer)
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(startedAt))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(sentAt))
	span.Status().SetCode(ptrace.StatusCodeError)
	span.Status().SetMessage("boom")
	span.Attributes().PutInt("http.response.status_code", 500)
	event := span.Events().AppendEmpty()
	event.SetName("exception")
	event.SetTimestamp(pcommon.NewTimestampFromTime(sentAt))
	event.Attributes().PutStr("exception.type", "E")
	event.Attributes().PutInt("everr.test.attempt", 42)
	span.Events().AppendEmpty().SetName("empty")
	link := span.Links().AppendEmpty()
	link.SetTraceID(pcommon.TraceID{4})
	link.SetSpanID(pcommon.SpanID{5})
	link.TraceState().FromRaw("vendor=2")
	link.Attributes().PutBool("everr.test.link", true)
	bare := scopeSpans.Spans().AppendEmpty()
	bare.SetName("bare")
	bare.SetStartTimestamp(pcommon.NewTimestampFromTime(sentAt))
	bare.SetEndTimestamp(pcommon.NewTimestampFromTime(sentAt))

	require.NoError(t, exp.ConsumeTraces(t.Context(), td))

	require.Equal(t, []string{
		"INSERT INTO otel.otel_traces SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow\n" +
			`{"Timestamp":` + startedAtText + `,"TraceId":"01000000000000000000000000000000","SpanId":"0200000000000000","ParentSpanId":"0300000000000000","TraceState":"vendor=1","SpanName":"POST /orders","SpanKind":"Server","ServiceName":"checkout","ResourceAttributes":{"everr.retention.days":"7","service.name":"checkout"},"ScopeName":"scope","ScopeVersion":"1.2.3","SpanAttributes":{"http.response.status_code":500},"Duration":90000000000,"StatusCode":"Error","StatusMessage":"boom","Events.Timestamp":[` + sentAtText + `,"1970-01-01T00:00:00Z"],"Events.Name":["exception","empty"],"Events.Attributes":[{"everr.test.attempt":42,"exception.type":"E"},{}],"Links.TraceId":["04000000000000000000000000000000"],"Links.SpanId":["0500000000000000"],"Links.TraceState":["vendor=2"],"Links.Attributes":[{"everr.test.link":true}],"ResourceAttributesKeys":["everr.retention.days","service.name"],"SpanAttributesKeys":["http.response.status_code"]}` + "\n" +
			`{"Timestamp":` + sentAtText + `,"TraceId":"","SpanId":"","ParentSpanId":"","TraceState":"","SpanName":"bare","SpanKind":"Unspecified","ServiceName":"checkout","ResourceAttributes":{"everr.retention.days":"7","service.name":"checkout"},"ScopeName":"scope","ScopeVersion":"1.2.3","SpanAttributes":{},"Duration":0,"StatusCode":"Unset","StatusMessage":"","Events.Timestamp":null,"Events.Name":null,"Events.Attributes":null,"Links.TraceId":null,"Links.SpanId":null,"Links.TraceState":null,"Links.Attributes":null,"ResourceAttributesKeys":["everr.retention.days","service.name"],"SpanAttributesKeys":null}` + "\n",
	}, session.Statements())
}

func TestEveryMetricKindIsWrittenToItsLandingTable(t *testing.T) {
	factory, cfg, session := newExporters(t)
	exp, err := factory.CreateMetrics(t.Context(), exportertest.NewNopSettings(factory.Type()), cfg)
	require.NoError(t, err)
	require.True(t, exp.Capabilities().MutatesData)
	require.NoError(t, exp.Start(t.Context(), componenttest.NewNopHost()))
	t.Cleanup(func() { _ = exp.Shutdown(t.Context()) })

	md := pmetric.NewMetrics()
	resourceMetrics := md.ResourceMetrics().AppendEmpty()
	resourceMetrics.SetSchemaUrl("resource-url")
	resourceMetrics.Resource().Attributes().PutStr("service.name", "checkout")
	resourceMetrics.Resource().Attributes().PutStr("everr.retention.days", "0")
	scopeMetrics := resourceMetrics.ScopeMetrics().AppendEmpty()
	scopeMetrics.SetSchemaUrl("scope-url")
	scopeMetrics.Scope().SetName("scope")
	scopeMetrics.Scope().SetVersion("1.2.3")
	scopeMetrics.Scope().Attributes().PutInt("scope.n", 1)
	scopeMetrics.Scope().SetDroppedAttributesCount(2)

	stamp := func(dp interface {
		SetStartTimestamp(pcommon.Timestamp)
		SetTimestamp(pcommon.Timestamp)
		Attributes() pcommon.Map
	}) {
		dp.SetStartTimestamp(pcommon.NewTimestampFromTime(startedAt))
		dp.SetTimestamp(pcommon.NewTimestampFromTime(sentAt))
		dp.Attributes().PutStr("region", "eu")
	}
	exemplar := func(exemplars pmetric.ExemplarSlice) {
		e := exemplars.AppendEmpty()
		e.SetTimestamp(pcommon.NewTimestampFromTime(sentAt))
		e.SetIntValue(4)
		e.SetTraceID(pcommon.TraceID{1})
		e.SetSpanID(pcommon.SpanID{2})
		e.FilteredAttributes().PutInt("worker", 9)
	}

	sum := scopeMetrics.Metrics().AppendEmpty()
	sum.SetName("orders")
	sum.SetDescription("placed orders")
	sum.SetUnit("{order}")
	sum.SetEmptySum().SetIsMonotonic(true)
	sum.Sum().SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	sumPoint := sum.Sum().DataPoints().AppendEmpty()
	sumPoint.SetIntValue(12)
	stamp(sumPoint)
	exemplar(sumPoint.Exemplars())

	gauge := scopeMetrics.Metrics().AppendEmpty()
	gauge.SetName("queue.depth")
	gaugePoint := gauge.SetEmptyGauge().DataPoints().AppendEmpty()
	gaugePoint.SetDoubleValue(1.5)
	stamp(gaugePoint)

	histogram := scopeMetrics.Metrics().AppendEmpty()
	histogram.SetName("latency")
	histogram.SetEmptyHistogram().SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
	histogramPoint := histogram.Histogram().DataPoints().AppendEmpty()
	histogramPoint.SetCount(3)
	histogramPoint.SetSum(6.5)
	histogramPoint.SetMin(1)
	histogramPoint.SetMax(4)
	histogramPoint.BucketCounts().FromRaw([]uint64{1, 2})
	histogramPoint.ExplicitBounds().FromRaw([]float64{2.5})
	stamp(histogramPoint)

	exponential := scopeMetrics.Metrics().AppendEmpty()
	exponential.SetName("latency.exp")
	exponential.SetEmptyExponentialHistogram().SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
	exponentialPoint := exponential.ExponentialHistogram().DataPoints().AppendEmpty()
	exponentialPoint.SetCount(3)
	exponentialPoint.SetSum(6.5)
	exponentialPoint.SetScale(2)
	exponentialPoint.SetZeroCount(1)
	exponentialPoint.Positive().SetOffset(-1)
	exponentialPoint.Positive().BucketCounts().FromRaw([]uint64{2})
	exponentialPoint.Negative().SetOffset(3)
	stamp(exponentialPoint)

	summary := scopeMetrics.Metrics().AppendEmpty()
	summary.SetName("latency.summary")
	summaryPoint := summary.SetEmptySummary().DataPoints().AppendEmpty()
	summaryPoint.SetCount(3)
	summaryPoint.SetSum(6.5)
	quantile := summaryPoint.QuantileValues().AppendEmpty()
	quantile.SetQuantile(0.5)
	quantile.SetValue(2)
	stamp(summaryPoint)

	require.NoError(t, exp.ConsumeMetrics(t.Context(), md))

	series := func(name, description, unit string) string {
		return `{"ResourceAttributes":{"everr.retention.days":"7","service.name":"checkout"},"ResourceSchemaUrl":"resource-url","ScopeName":"scope","ScopeVersion":"1.2.3","ScopeAttributes":{"scope.n":"1"},"ScopeDroppedAttrCount":2,"ScopeSchemaUrl":"scope-url","ServiceName":"checkout","MetricName":"` + name + `","MetricDescription":"` + description + `","MetricUnit":"` + unit + `","Attributes":{"region":"eu"},"StartTimeUnix":` + startedAtText + `,"TimeUnix":` + sentAtText + `,`
	}
	const noExemplars = `"Exemplars.FilteredAttributes":null,"Exemplars.TimeUnix":null,"Exemplars.Value":null,"Exemplars.SpanId":null,"Exemplars.TraceId":null`
	require.Equal(t, []string{
		"INSERT INTO otel.otel_metrics_gauge SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow\n" +
			series("queue.depth", "", "") + `"Value":1.5,"Flags":0,` + noExemplars + "}\n",
		"INSERT INTO otel.otel_metrics_sum SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow\n" +
			series("orders", "placed orders", "{order}") + `"Value":12,"Flags":0,"Exemplars.FilteredAttributes":[{"worker":"9"}],"Exemplars.TimeUnix":[` + sentAtText + `],"Exemplars.Value":[4],"Exemplars.SpanId":["0200000000000000"],"Exemplars.TraceId":["01000000000000000000000000000000"],"AggregationTemporality":2,"IsMonotonic":true}` + "\n",
		"INSERT INTO otel.otel_metrics_histogram SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow\n" +
			series("latency", "", "") + `"Count":3,"Sum":6.5,"BucketCounts":[1,2],"ExplicitBounds":[2.5],` + noExemplars + `,"Flags":0,"Min":1,"Max":4,"AggregationTemporality":1}` + "\n",
		"INSERT INTO otel.otel_metrics_exponential_histogram SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow\n" +
			series("latency.exp", "", "") + `"Count":3,"Sum":6.5,"Scale":2,"ZeroCount":1,"PositiveOffset":-1,"PositiveBucketCounts":[2],"NegativeOffset":3,"NegativeBucketCounts":null,` + noExemplars + `,"Flags":0,"Min":0,"Max":0,"AggregationTemporality":1}` + "\n",
		"INSERT INTO otel.otel_metrics_summary SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow\n" +
			series("latency.summary", "", "") + `"Count":3,"Sum":6.5,"ValueAtQuantiles.Quantile":[0.5],"ValueAtQuantiles.Value":[2],"Flags":0}` + "\n",
	}, session.Statements())
}

func TestAMetricWithoutATypeFailsThePush(t *testing.T) {
	factory, cfg, session := newExporters(t)
	exp, err := factory.CreateMetrics(t.Context(), exportertest.NewNopSettings(factory.Type()), cfg)
	require.NoError(t, err)
	require.NoError(t, exp.Start(t.Context(), componenttest.NewNopHost()))
	t.Cleanup(func() { _ = exp.Shutdown(t.Context()) })

	md := pmetric.NewMetrics()
	md.ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty().Metrics().AppendEmpty().SetName("untyped")

	require.ErrorContains(t, exp.ConsumeMetrics(t.Context(), md), "metrics type is unset")
	require.Empty(t, session.Statements())
}
