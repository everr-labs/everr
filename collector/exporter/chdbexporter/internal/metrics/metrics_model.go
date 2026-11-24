// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package metrics // import "github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metrics"

import (
	"context"
	"encoding/hex"
	"errors"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/landing"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

type Rows struct {
	gauge                *landing.Batch
	sum                  *landing.Batch
	histogram            *landing.Batch
	exponentialHistogram *landing.Batch
	summary              *landing.Batch
}

func NewRows() *Rows {
	return &Rows{
		gauge:                landing.NewBatch(landing.MetricsGauge),
		sum:                  landing.NewBatch(landing.MetricsSum),
		histogram:            landing.NewBatch(landing.MetricsHistogram),
		exponentialHistogram: landing.NewBatch(landing.MetricsExponentialHistogram),
		summary:              landing.NewBatch(landing.MetricsSummary),
	}
}

type MetricsMetaData struct {
	ResAttr    pcommon.Map
	ResURL     string
	ScopeURL   string
	ScopeInstr pcommon.InstrumentationScope
}

func (r *Rows) Add(metadata MetricsMetaData, metric pmetric.Metric) error {
	switch metric.Type() {
	case pmetric.MetricTypeGauge:
		return appendGauge(r.gauge, metadata, metric)
	case pmetric.MetricTypeSum:
		return appendSum(r.sum, metadata, metric)
	case pmetric.MetricTypeHistogram:
		return appendHistogram(r.histogram, metadata, metric)
	case pmetric.MetricTypeExponentialHistogram:
		return appendExponentialHistogram(r.exponentialHistogram, metadata, metric)
	case pmetric.MetricTypeSummary:
		return appendSummary(r.summary, metadata, metric)
	case pmetric.MetricTypeEmpty:
		return errors.New("metrics type is unset")
	default:
		return errors.New("unsupported metrics type")
	}
}

// Send inserts every kind and returns the kinds whose insert failed. A kind
// that fails does not stop the others.
func (r *Rows) Send(ctx context.Context, handle *chdb.Handle) (failed []pmetric.MetricType, err error) {
	for _, kind := range []struct {
		metricType pmetric.MetricType
		batch      *landing.Batch
	}{
		{pmetric.MetricTypeGauge, r.gauge},
		{pmetric.MetricTypeSum, r.sum},
		{pmetric.MetricTypeHistogram, r.histogram},
		{pmetric.MetricTypeExponentialHistogram, r.exponentialHistogram},
		{pmetric.MetricTypeSummary, r.summary},
	} {
		if sendErr := kind.batch.Send(ctx, handle); sendErr != nil {
			failed = append(failed, kind.metricType)
			err = errors.Join(err, sendErr)
		}
	}
	return failed, err
}

func convertExemplars(exemplars pmetric.ExemplarSlice) (attrs []map[string]string, times []time.Time, values []float64, traceIDs, spanIDs []string) {
	n := exemplars.Len()
	if n == 0 {
		return nil, nil, nil, nil, nil
	}
	attrs = make([]map[string]string, 0, n)
	times = make([]time.Time, 0, n)
	values = make([]float64, 0, n)
	traceIDs = make([]string, 0, n)
	spanIDs = make([]string, 0, n)
	for i := range n {
		exemplar := exemplars.At(i)
		attrs = append(attrs, AttributesToMap(exemplar.FilteredAttributes()))
		times = append(times, exemplar.Timestamp().AsTime())
		values = append(values, getValue(exemplar.IntValue(), exemplar.DoubleValue(), exemplar.ValueType()))

		traceID, spanID := exemplar.TraceID(), exemplar.SpanID()
		traceIDs = append(traceIDs, hex.EncodeToString(traceID[:]))
		spanIDs = append(spanIDs, hex.EncodeToString(spanID[:]))
	}
	return attrs, times, values, traceIDs, spanIDs
}

// https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/metrics/v1/metrics.proto#L358
// define two types for one datapoint value, clickhouse only use one value of float64 to store them
func getValue(intValue int64, floatValue float64, dataType any) float64 {
	switch dataType {
	case pmetric.ExemplarValueTypeDouble, pmetric.NumberDataPointValueTypeDouble:
		return floatValue
	case pmetric.ExemplarValueTypeInt, pmetric.NumberDataPointValueTypeInt:
		return float64(intValue)
	default:
		return 0.0
	}
}

func AttributesToMap(attributes pcommon.Map) map[string]string {
	out := make(map[string]string, attributes.Len())
	attributes.Range(func(k string, v pcommon.Value) bool {
		out[k] = v.AsString()
		return true
	})
	return out
}

func convertValueAtQuantile(valueAtQuantile pmetric.SummaryDataPointValueAtQuantileSlice) (quantiles, values []float64) {
	n := valueAtQuantile.Len()
	if n == 0 {
		return nil, nil
	}
	quantiles = make([]float64, 0, n)
	values = make([]float64, 0, n)
	for i := range n {
		value := valueAtQuantile.At(i)
		quantiles = append(quantiles, value.Quantile())
		values = append(values, value.Value())
	}
	return quantiles, values
}
