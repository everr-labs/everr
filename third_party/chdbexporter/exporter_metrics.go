package clickhouseexporter

import (
	"context"
	"fmt"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.uber.org/zap"

	"github.com/everr-labs/chdbexporter/internal"
	"github.com/everr-labs/chdbexporter/internal/sqltemplates"
)

type metricsExporter struct {
	chdbRunner
}

func newMetricsExporter(logger *zap.Logger, cfg *Config) *metricsExporter {
	return &metricsExporter{
		chdbRunner: chdbRunner{cfg: cfg, logger: logger},
	}
}

func (e *metricsExporter) start(ctx context.Context, _ component.Host) error {
	return e.execAll(
		ctx,
		renderCreateGaugeMetricsTableSQL(e.cfg),
		renderCreateSumMetricsTableSQL(e.cfg),
		renderCreateHistogramMetricsTableSQL(e.cfg),
		renderCreateExpHistogramMetricsTableSQL(e.cfg),
		renderCreateSummaryMetricsTableSQL(e.cfg),
	)
}

func (e *metricsExporter) shutdown(context.Context) error {
	return nil
}

func (e *metricsExporter) pushMetricsData(ctx context.Context, md pmetric.Metrics) error {
	var gaugeRows []map[string]any
	var sumRows []map[string]any
	var histogramRows []map[string]any
	var expHistogramRows []map[string]any
	var summaryRows []map[string]any

	resourceMetrics := md.ResourceMetrics()
	for i := 0; i < resourceMetrics.Len(); i++ {
		rm := resourceMetrics.At(i)
		resourceAttrs := internal.AttributesToMap(rm.Resource().Attributes())
		serviceName := internal.GetServiceName(rm.Resource().Attributes())

		scopeMetrics := rm.ScopeMetrics()
		for j := 0; j < scopeMetrics.Len(); j++ {
			scopeMetric := scopeMetrics.At(j)
			scope := scopeMetric.Scope()
			scopeAttrs := internal.AttributesToMap(scope.Attributes())
			scopeMeta := metricScopeMeta{
				resourceAttrs:         resourceAttrs,
				resourceSchemaURL:     rm.SchemaUrl(),
				scopeName:             scope.Name(),
				scopeVersion:          scope.Version(),
				scopeAttrs:            scopeAttrs,
				scopeDroppedAttrCount: scope.DroppedAttributesCount(),
				scopeSchemaURL:        scopeMetric.SchemaUrl(),
				serviceName:           serviceName,
			}

			metrics := scopeMetric.Metrics()
			for k := 0; k < metrics.Len(); k++ {
				metric := metrics.At(k)
				switch metric.Type() {
				case pmetric.MetricTypeGauge:
					gaugeRows = append(gaugeRows, gaugeMetricRows(metric, scopeMeta)...)
				case pmetric.MetricTypeSum:
					sumRows = append(sumRows, sumMetricRows(metric, scopeMeta)...)
				case pmetric.MetricTypeHistogram:
					histogramRows = append(histogramRows, histogramMetricRows(metric, scopeMeta)...)
				case pmetric.MetricTypeExponentialHistogram:
					expHistogramRows = append(expHistogramRows, expHistogramMetricRows(metric, scopeMeta)...)
				case pmetric.MetricTypeSummary:
					summaryRows = append(summaryRows, summaryMetricRows(metric, scopeMeta)...)
				}
			}
		}
	}

	if err := e.insertRows(ctx, e.cfg.metricsGaugeTableName(), gaugeRows); err != nil {
		return err
	}
	if err := e.insertRows(ctx, e.cfg.metricsSumTableName(), sumRows); err != nil {
		return err
	}
	if err := e.insertRows(ctx, e.cfg.metricsHistogramTableName(), histogramRows); err != nil {
		return err
	}
	if err := e.insertRows(ctx, e.cfg.metricsExponentialHistogramTableName(), expHistogramRows); err != nil {
		return err
	}
	if err := e.insertRows(ctx, e.cfg.metricsSummaryTableName(), summaryRows); err != nil {
		return err
	}

	return nil
}

type metricScopeMeta struct {
	resourceAttrs         map[string]string
	resourceSchemaURL     string
	scopeName             string
	scopeVersion          string
	scopeAttrs            map[string]string
	scopeDroppedAttrCount uint32
	scopeSchemaURL        string
	serviceName           string
}

func gaugeMetricRows(metric pmetric.Metric, meta metricScopeMeta) []map[string]any {
	points := metric.Gauge().DataPoints()
	rows := make([]map[string]any, 0, points.Len())
	for i := 0; i < points.Len(); i++ {
		point := points.At(i)
		exemplarAttrs, exemplarTimes, exemplarValues, exemplarSpanIDs, exemplarTraceIDs := convertExemplars(point.Exemplars())
		rows = append(rows, metricBaseRow(metric, meta, point.Attributes(), point.StartTimestamp(), point.Timestamp(), map[string]any{
			"Value":                        getNumberValue(point.IntValue(), point.DoubleValue(), point.ValueType()),
			"Flags":                        uint32(point.Flags()),
			"Exemplars.FilteredAttributes": exemplarAttrs,
			"Exemplars.TimeUnix":           exemplarTimes,
			"Exemplars.Value":              exemplarValues,
			"Exemplars.SpanId":             exemplarSpanIDs,
			"Exemplars.TraceId":            exemplarTraceIDs,
		}))
	}
	return rows
}

func sumMetricRows(metric pmetric.Metric, meta metricScopeMeta) []map[string]any {
	points := metric.Sum().DataPoints()
	rows := make([]map[string]any, 0, points.Len())
	for i := 0; i < points.Len(); i++ {
		point := points.At(i)
		exemplarAttrs, exemplarTimes, exemplarValues, exemplarSpanIDs, exemplarTraceIDs := convertExemplars(point.Exemplars())
		rows = append(rows, metricBaseRow(metric, meta, point.Attributes(), point.StartTimestamp(), point.Timestamp(), map[string]any{
			"Value":                        getNumberValue(point.IntValue(), point.DoubleValue(), point.ValueType()),
			"Flags":                        uint32(point.Flags()),
			"Exemplars.FilteredAttributes": exemplarAttrs,
			"Exemplars.TimeUnix":           exemplarTimes,
			"Exemplars.Value":              exemplarValues,
			"Exemplars.SpanId":             exemplarSpanIDs,
			"Exemplars.TraceId":            exemplarTraceIDs,
			"AggregationTemporality":       int32(metric.Sum().AggregationTemporality()),
			"IsMonotonic":                  metric.Sum().IsMonotonic(),
		}))
	}
	return rows
}

func histogramMetricRows(metric pmetric.Metric, meta metricScopeMeta) []map[string]any {
	points := metric.Histogram().DataPoints()
	rows := make([]map[string]any, 0, points.Len())
	for i := 0; i < points.Len(); i++ {
		point := points.At(i)
		exemplarAttrs, exemplarTimes, exemplarValues, exemplarSpanIDs, exemplarTraceIDs := convertExemplars(point.Exemplars())
		rows = append(rows, metricBaseRow(metric, meta, point.Attributes(), point.StartTimestamp(), point.Timestamp(), map[string]any{
			"Count":                        point.Count(),
			"Sum":                          point.Sum(),
			"BucketCounts":                 point.BucketCounts().AsRaw(),
			"ExplicitBounds":               point.ExplicitBounds().AsRaw(),
			"Exemplars.FilteredAttributes": exemplarAttrs,
			"Exemplars.TimeUnix":           exemplarTimes,
			"Exemplars.Value":              exemplarValues,
			"Exemplars.SpanId":             exemplarSpanIDs,
			"Exemplars.TraceId":            exemplarTraceIDs,
			"Flags":                        uint32(point.Flags()),
			"Min":                          metricMin(point.HasMin(), point.Min()),
			"Max":                          metricMax(point.HasMax(), point.Max()),
			"AggregationTemporality":       int32(metric.Histogram().AggregationTemporality()),
		}))
	}
	return rows
}

func expHistogramMetricRows(metric pmetric.Metric, meta metricScopeMeta) []map[string]any {
	points := metric.ExponentialHistogram().DataPoints()
	rows := make([]map[string]any, 0, points.Len())
	for i := 0; i < points.Len(); i++ {
		point := points.At(i)
		exemplarAttrs, exemplarTimes, exemplarValues, exemplarSpanIDs, exemplarTraceIDs := convertExemplars(point.Exemplars())
		rows = append(rows, metricBaseRow(metric, meta, point.Attributes(), point.StartTimestamp(), point.Timestamp(), map[string]any{
			"Count":                        point.Count(),
			"Sum":                          point.Sum(),
			"Scale":                        point.Scale(),
			"ZeroCount":                    point.ZeroCount(),
			"PositiveOffset":               point.Positive().Offset(),
			"PositiveBucketCounts":         point.Positive().BucketCounts().AsRaw(),
			"NegativeOffset":               point.Negative().Offset(),
			"NegativeBucketCounts":         point.Negative().BucketCounts().AsRaw(),
			"Exemplars.FilteredAttributes": exemplarAttrs,
			"Exemplars.TimeUnix":           exemplarTimes,
			"Exemplars.Value":              exemplarValues,
			"Exemplars.SpanId":             exemplarSpanIDs,
			"Exemplars.TraceId":            exemplarTraceIDs,
			"Flags":                        uint32(point.Flags()),
			"Min":                          metricMin(point.HasMin(), point.Min()),
			"Max":                          metricMax(point.HasMax(), point.Max()),
			"AggregationTemporality":       int32(metric.ExponentialHistogram().AggregationTemporality()),
		}))
	}
	return rows
}

func summaryMetricRows(metric pmetric.Metric, meta metricScopeMeta) []map[string]any {
	points := metric.Summary().DataPoints()
	rows := make([]map[string]any, 0, points.Len())
	for i := 0; i < points.Len(); i++ {
		point := points.At(i)
		quantiles, values := convertQuantiles(point.QuantileValues())
		rows = append(rows, metricBaseRow(metric, meta, point.Attributes(), point.StartTimestamp(), point.Timestamp(), map[string]any{
			"Count":                     point.Count(),
			"Sum":                       point.Sum(),
			"ValueAtQuantiles.Quantile": quantiles,
			"ValueAtQuantiles.Value":    values,
			"Flags":                     uint32(point.Flags()),
		}))
	}
	return rows
}

func metricBaseRow(
	metric pmetric.Metric,
	meta metricScopeMeta,
	attrs pcommon.Map,
	start pcommon.Timestamp,
	ts pcommon.Timestamp,
	extra map[string]any,
) map[string]any {
	row := map[string]any{
		"ResourceAttributes":    meta.resourceAttrs,
		"ResourceSchemaUrl":     meta.resourceSchemaURL,
		"ScopeName":             meta.scopeName,
		"ScopeVersion":          meta.scopeVersion,
		"ScopeAttributes":       meta.scopeAttrs,
		"ScopeDroppedAttrCount": meta.scopeDroppedAttrCount,
		"ScopeSchemaUrl":        meta.scopeSchemaURL,
		"ServiceName":           meta.serviceName,
		"MetricName":            metric.Name(),
		"MetricDescription":     metric.Description(),
		"MetricUnit":            metric.Unit(),
		"Attributes":            internal.AttributesToMap(attrs),
		"StartTimeUnix":         formatTimestamp(start.AsTime()),
		"TimeUnix":              formatTimestamp(ts.AsTime()),
	}
	for key, value := range extra {
		row[key] = value
	}
	return row
}

func convertExemplars(exemplars pmetric.ExemplarSlice) ([]map[string]string, []string, []float64, []string, []string) {
	attrs := make([]map[string]string, 0, exemplars.Len())
	times := make([]string, 0, exemplars.Len())
	values := make([]float64, 0, exemplars.Len())
	spanIDs := make([]string, 0, exemplars.Len())
	traceIDs := make([]string, 0, exemplars.Len())
	for i := 0; i < exemplars.Len(); i++ {
		exemplar := exemplars.At(i)
		attrs = append(attrs, internal.AttributesToMap(exemplar.FilteredAttributes()))
		times = append(times, formatTimestamp(exemplar.Timestamp().AsTime()))
		values = append(values, getExemplarValue(exemplar))
		spanIDs = append(spanIDs, fmt.Sprintf("%x", exemplar.SpanID()))
		traceIDs = append(traceIDs, fmt.Sprintf("%x", exemplar.TraceID()))
	}
	return attrs, times, values, spanIDs, traceIDs
}

func convertQuantiles(values pmetric.SummaryDataPointValueAtQuantileSlice) ([]float64, []float64) {
	quantiles := make([]float64, 0, values.Len())
	rows := make([]float64, 0, values.Len())
	for i := 0; i < values.Len(); i++ {
		item := values.At(i)
		quantiles = append(quantiles, item.Quantile())
		rows = append(rows, item.Value())
	}
	return quantiles, rows
}

func getExemplarValue(exemplar pmetric.Exemplar) float64 {
	switch exemplar.ValueType() {
	case pmetric.ExemplarValueTypeInt:
		return float64(exemplar.IntValue())
	case pmetric.ExemplarValueTypeDouble:
		return exemplar.DoubleValue()
	default:
		return 0
	}
}

func getNumberValue(intValue int64, doubleValue float64, valueType pmetric.NumberDataPointValueType) float64 {
	switch valueType {
	case pmetric.NumberDataPointValueTypeInt:
		return float64(intValue)
	case pmetric.NumberDataPointValueTypeDouble:
		return doubleValue
	default:
		return 0
	}
}

func metricMin(has bool, value float64) float64 {
	if has {
		return value
	}
	return 0
}

func metricMax(has bool, value float64) float64 {
	if has {
		return value
	}
	return 0
}

func renderCreateGaugeMetricsTableSQL(cfg *Config) string {
	ttlExpr := internal.GenerateTTLExpr(cfg.TTL, "toDateTime(TimeUnix)")
	return fmt.Sprintf(sqltemplates.MetricsGaugeCreateTable, cfg.database(), cfg.metricsGaugeTableName(), "", "MergeTree()", ttlExpr)
}

func renderCreateSumMetricsTableSQL(cfg *Config) string {
	ttlExpr := internal.GenerateTTLExpr(cfg.TTL, "toDateTime(TimeUnix)")
	return fmt.Sprintf(sqltemplates.MetricsSumCreateTable, cfg.database(), cfg.metricsSumTableName(), "", "MergeTree()", ttlExpr)
}

func renderCreateHistogramMetricsTableSQL(cfg *Config) string {
	ttlExpr := internal.GenerateTTLExpr(cfg.TTL, "toDateTime(TimeUnix)")
	return fmt.Sprintf(sqltemplates.MetricsHistogramCreateTable, cfg.database(), cfg.metricsHistogramTableName(), "", "MergeTree()", ttlExpr)
}

func renderCreateExpHistogramMetricsTableSQL(cfg *Config) string {
	ttlExpr := internal.GenerateTTLExpr(cfg.TTL, "toDateTime(TimeUnix)")
	return fmt.Sprintf(sqltemplates.MetricsExpHistogramCreateTable, cfg.database(), cfg.metricsExponentialHistogramTableName(), "", "MergeTree()", ttlExpr)
}

func renderCreateSummaryMetricsTableSQL(cfg *Config) string {
	ttlExpr := internal.GenerateTTLExpr(cfg.TTL, "toDateTime(TimeUnix)")
	return fmt.Sprintf(sqltemplates.MetricsSummaryCreateTable, cfg.database(), cfg.metricsSummaryTableName(), "", "MergeTree()", ttlExpr)
}
