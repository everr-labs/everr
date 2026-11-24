// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package metrics

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
)

func Test_attributesToMap(t *testing.T) {
	attributes := pcommon.NewMap()
	attributes.PutStr("key", "value")
	attributes.PutBool("bool", true)
	attributes.PutInt("int", 0)
	attributes.PutDouble("double", 0.0)
	result := AttributesToMap(attributes)
	require.Equal(
		t,
		map[string]string{
			"key":    "value",
			"bool":   "true",
			"int":    "0",
			"double": "0",
		},
		result,
	)
}

func Test_convertExemplars(t *testing.T) {
	t.Run("empty exemplar", func(t *testing.T) {
		exemplars := pmetric.NewExemplarSlice()
		attrs, times, values, traceIDs, spanIDs := convertExemplars(exemplars)
		require.Empty(t, attrs)
		require.Empty(t, times)
		require.Empty(t, values)
		require.Empty(t, traceIDs)
		require.Empty(t, spanIDs)
	})
	t.Run("one exemplar with only FilteredAttributes", func(t *testing.T) {
		exemplars := pmetric.NewExemplarSlice()
		exemplar := exemplars.AppendEmpty()
		exemplar.FilteredAttributes().PutStr("key1", "value1")
		exemplar.FilteredAttributes().PutStr("key2", "value2")

		attrs, times, values, traceIDs, spanIDs := convertExemplars(exemplars)
		require.Equal(t, []map[string]string{{"key1": "value1", "key2": "value2"}}, attrs)
		require.Equal(t, []time.Time{time.Date(1970, time.January, 1, 0, 0, 0, 0, time.UTC)}, times)
		require.Equal(t, []float64{0.0}, values)
		require.Equal(t, []string{"00000000000000000000000000000000"}, traceIDs)
		require.Equal(t, []string{"0000000000000000"}, spanIDs)
	})
	t.Run("one exemplar with only TimeUnixNano", func(t *testing.T) {
		exemplars := pmetric.NewExemplarSlice()
		exemplar := exemplars.AppendEmpty()
		exemplar.SetTimestamp(pcommon.NewTimestampFromTime(time.Unix(1672218930, 0)))

		attrs, times, values, traceIDs, spanIDs := convertExemplars(exemplars)
		require.Equal(t, []map[string]string{{}}, attrs)
		require.Equal(t, []time.Time{time.Unix(1672218930, 0).UTC()}, times)
		require.Equal(t, []float64{0.0}, values)
		require.Equal(t, []string{"00000000000000000000000000000000"}, traceIDs)
		require.Equal(t, []string{"0000000000000000"}, spanIDs)
	})
	t.Run("one exemplar with only DoubleValue ", func(t *testing.T) {
		exemplars := pmetric.NewExemplarSlice()
		exemplar := exemplars.AppendEmpty()
		exemplar.SetDoubleValue(15.0)

		attrs, times, values, traceIDs, spanIDs := convertExemplars(exemplars)
		require.Equal(t, []map[string]string{{}}, attrs)
		require.Equal(t, []time.Time{time.Date(1970, time.January, 1, 0, 0, 0, 0, time.UTC)}, times)
		require.Equal(t, []float64{15.0}, values)
		require.Equal(t, []string{"00000000000000000000000000000000"}, traceIDs)
		require.Equal(t, []string{"0000000000000000"}, spanIDs)
	})
	t.Run("one exemplar with only IntValue ", func(t *testing.T) {
		exemplars := pmetric.NewExemplarSlice()
		exemplar := exemplars.AppendEmpty()
		exemplar.SetIntValue(20)

		attrs, times, values, traceIDs, spanIDs := convertExemplars(exemplars)
		require.Equal(t, []map[string]string{{}}, attrs)
		require.Equal(t, []time.Time{time.Date(1970, time.January, 1, 0, 0, 0, 0, time.UTC)}, times)
		require.Equal(t, []float64{20.0}, values)
		require.Equal(t, []string{"00000000000000000000000000000000"}, traceIDs)
		require.Equal(t, []string{"0000000000000000"}, spanIDs)
	})
	t.Run("one exemplar with only SpanId", func(t *testing.T) {
		exemplars := pmetric.NewExemplarSlice()
		exemplar := exemplars.AppendEmpty()
		exemplar.SetSpanID([8]byte{1, 2, 3, 4})

		attrs, times, values, traceIDs, spanIDs := convertExemplars(exemplars)
		require.Equal(t, []map[string]string{{}}, attrs)
		require.Equal(t, []time.Time{time.Date(1970, time.January, 1, 0, 0, 0, 0, time.UTC)}, times)
		require.Equal(t, []float64{0.0}, values)
		require.Equal(t, []string{"00000000000000000000000000000000"}, traceIDs)
		require.Equal(t, []string{"0102030400000000"}, spanIDs)
	})
	t.Run("one exemplar with only TraceID", func(t *testing.T) {
		exemplars := pmetric.NewExemplarSlice()
		exemplar := exemplars.AppendEmpty()
		exemplar.SetTraceID([16]byte{1, 2, 3, 4})

		attrs, times, values, traceIDs, spanIDs := convertExemplars(exemplars)
		require.Equal(t, []map[string]string{{}}, attrs)
		require.Equal(t, []time.Time{time.Date(1970, time.January, 1, 0, 0, 0, 0, time.UTC)}, times)
		require.Equal(t, []float64{0.0}, values)
		require.Equal(t, []string{"01020304000000000000000000000000"}, traceIDs)
		require.Equal(t, []string{"0000000000000000"}, spanIDs)
	})
	t.Run("two exemplars", func(t *testing.T) {
		exemplars := pmetric.NewExemplarSlice()
		exemplar := exemplars.AppendEmpty()
		exemplar.FilteredAttributes().PutStr("key1", "value1")
		exemplar.FilteredAttributes().PutStr("key2", "value2")
		exemplar.SetTimestamp(pcommon.NewTimestampFromTime(time.Unix(1672218930, 0)))
		exemplar.SetDoubleValue(15.0)
		exemplar.SetIntValue(20)
		exemplar.SetSpanID([8]byte{1, 2, 3, 4})
		exemplar.SetTraceID([16]byte{1, 2, 3, 4})

		exemplar = exemplars.AppendEmpty()
		exemplar.FilteredAttributes().PutStr("key3", "value3")
		exemplar.FilteredAttributes().PutStr("key4", "value4")
		exemplar.SetTimestamp(pcommon.NewTimestampFromTime(time.Unix(1672219930, 0)))
		exemplar.SetIntValue(21)
		exemplar.SetDoubleValue(16.0)
		exemplar.SetSpanID([8]byte{1, 2, 3, 5})
		exemplar.SetTraceID([16]byte{1, 2, 3, 5})

		attrs, times, values, traceIDs, spanIDs := convertExemplars(exemplars)
		require.Equal(t, []map[string]string{{"key1": "value1", "key2": "value2"}, {"key3": "value3", "key4": "value4"}}, attrs)
		require.Equal(t, []time.Time{time.Unix(1672218930, 0).UTC(), time.Unix(1672219930, 0).UTC()}, times)
		require.Equal(t, []float64{20.0, 16.0}, values)
		require.Equal(t, []string{"01020304000000000000000000000000", "01020305000000000000000000000000"}, traceIDs)
		require.Equal(t, []string{"0102030400000000", "0102030500000000"}, spanIDs)
	})
}

func Test_convertValueAtQuantile(t *testing.T) {
	t.Run("empty valueAtQuantileSlice", func(t *testing.T) {
		valueAtQuantileSlice := pmetric.NewSummaryDataPointValueAtQuantileSlice()
		quantiles, values := convertValueAtQuantile(valueAtQuantileSlice)
		require.Empty(t, quantiles)
		require.Empty(t, values)
	})

	t.Run("one valueAtQuantile with only set Value", func(t *testing.T) {
		valueAtQuantileSlice := pmetric.NewSummaryDataPointValueAtQuantileSlice()
		valueAtQuantile := valueAtQuantileSlice.AppendEmpty()
		valueAtQuantile.SetValue(1.0)

		quantiles, values := convertValueAtQuantile(valueAtQuantileSlice)
		require.Equal(t, []float64{0.0}, quantiles)
		require.Equal(t, []float64{1.0}, values)
	})

	t.Run("one valueAtQuantile with only set Quantile", func(t *testing.T) {
		valueAtQuantileSlice := pmetric.NewSummaryDataPointValueAtQuantileSlice()
		valueAtQuantile := valueAtQuantileSlice.AppendEmpty()
		valueAtQuantile.SetQuantile(1.0)

		quantiles, values := convertValueAtQuantile(valueAtQuantileSlice)
		require.Equal(t, []float64{1.0}, quantiles)
		require.Equal(t, []float64{0.0}, values)
	})

	t.Run("two valueAtQuantiles", func(t *testing.T) {
		valueAtQuantileSlice := pmetric.NewSummaryDataPointValueAtQuantileSlice()
		valueAtQuantile := valueAtQuantileSlice.AppendEmpty()
		valueAtQuantile.SetQuantile(1.0)
		valueAtQuantile.SetValue(1.0)

		valueAtQuantile = valueAtQuantileSlice.AppendEmpty()
		valueAtQuantile.SetQuantile(2.0)
		valueAtQuantile.SetValue(2.0)

		quantiles, values := convertValueAtQuantile(valueAtQuantileSlice)
		require.Equal(t, []float64{1.0, 2.0}, quantiles)
		require.Equal(t, []float64{1.0, 2.0}, values)
	})
}

func Test_getValue(t *testing.T) {
	t.Run("set int64 value with NumberDataPointValueType", func(t *testing.T) {
		require.Equal(t, 10.0, getValue(int64(10), 0, pmetric.NumberDataPointValueTypeInt))
	})
	t.Run("set float64 value with NumberDataPointValueType", func(t *testing.T) {
		require.Equal(t, 20.0, getValue(0, 20.0, pmetric.NumberDataPointValueTypeDouble))
	})
	t.Run("set int64 value with ExemplarValueType", func(t *testing.T) {
		require.Equal(t, 10.0, getValue(int64(10), 0, pmetric.ExemplarValueTypeInt))
	})
	t.Run("set float64 value with ExemplarValueType", func(t *testing.T) {
		require.Equal(t, 20.0, getValue(0, 20.0, pmetric.ExemplarValueTypeDouble))
	})
	t.Run("set a unsupport dataType", func(t *testing.T) {
		require.Equal(t, 0.0, getValue(int64(10), 0, pmetric.MetricTypeHistogram))
	})
}
