// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap/zaptest"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

// The chDB adapter writes JSONEachRow without knowing the column types, so
// these tests push one row per signal through the real exporter path and
// read the stored timestamps back from the tables the shipped templates
// create. The metric tables store seconds, the log and trace tables store
// nanoseconds, and one encoding has to be right for both.

var (
	roundTripTime      = time.Date(2026, 9, 5, 12, 34, 56, 123456789, time.UTC)
	roundTripStartTime = roundTripTime.Add(-90 * time.Second)
	roundTripExemplar  = roundTripTime.Add(-5 * time.Second)
)

func openRealChDB(t *testing.T) *chdb.Handle {
	t.Helper()
	t.Cleanup(chdb.ResetForTesting)
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = handle.Close() })
	return handle
}

func queryJSONRows(t *testing.T, handle *chdb.Handle, query string) []map[string]any {
	t.Helper()
	var rows []map[string]any
	require.NoError(t, handle.Do(t.Context(), func(_ context.Context, session chdb.Session) error {
		result, err := session.Query(query, "JSONEachRow")
		if err != nil {
			return err
		}
		if result == nil {
			return nil
		}
		defer result.Free()
		for _, line := range strings.Split(strings.TrimSpace(string(result.Buf())), "\n") {
			if line == "" {
				continue
			}
			var row map[string]any
			if err := json.Unmarshal([]byte(line), &row); err != nil {
				return err
			}
			rows = append(rows, row)
		}
		return nil
	}))
	return rows
}

func utcSeconds(ts time.Time) string {
	return ts.UTC().Format("2006-01-02 15:04:05")
}

func TestChDBRoundTripStoresMetricTimestamps(t *testing.T) {
	handle := openRealChDB(t)
	cfg := withDefaultConfig()
	exp := newMetricsExporter(zaptest.NewLogger(t), cfg, handle)
	require.NoError(t, exp.start(t.Context(), nil))
	t.Cleanup(func() { _ = exp.shutdown(context.Background()) })

	require.NoError(t, exp.pushMetricsData(t.Context(), oneMetricOfEachType()))

	tables := []struct {
		name         string
		hasExemplars bool
	}{
		{cfg.MetricsTables.Gauge.Name, true},
		{cfg.MetricsTables.Sum.Name, true},
		{cfg.MetricsTables.Histogram.Name, true},
		{cfg.MetricsTables.ExponentialHistogram.Name, true},
		{cfg.MetricsTables.Summary.Name, false},
	}
	for _, table := range tables {
		t.Run(table.name, func(t *testing.T) {
			from := ` FROM "` + cfg.database() + `"."` + table.name + `"`
			rows := queryJSONRows(t, handle,
				`SELECT toString(toDateTime(TimeUnix), 'UTC') AS time, toString(toDateTime(StartTimeUnix), 'UTC') AS start`+from)
			require.Len(t, rows, 1)
			require.Equal(t, utcSeconds(roundTripTime), rows[0]["time"])
			require.Equal(t, utcSeconds(roundTripStartTime), rows[0]["start"])

			if !table.hasExemplars {
				return
			}
			rows = queryJSONRows(t, handle,
				`SELECT arrayMap(x -> toString(toDateTime(x), 'UTC'), Exemplars.TimeUnix) AS exemplars`+from)
			require.Len(t, rows, 1)
			require.Equal(t, []any{utcSeconds(roundTripExemplar)}, rows[0]["exemplars"])
		})
	}
}

func TestChDBRoundTripKeepsLogTimestampNanoseconds(t *testing.T) {
	handle := openRealChDB(t)
	cfg := withDefaultConfig()
	exp := newLogsExporter(zaptest.NewLogger(t), cfg, handle)
	require.NoError(t, exp.start(t.Context(), nil))
	t.Cleanup(func() { _ = exp.shutdown(context.Background()) })

	ld := plog.NewLogs()
	record := ld.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	record.SetTimestamp(pcommon.NewTimestampFromTime(roundTripTime))
	record.Body().SetStr("round trip")
	require.NoError(t, exp.pushLogsData(t.Context(), ld))

	rows := queryJSONRows(t, handle,
		`SELECT toString(toUnixTimestamp64Nano(Timestamp)) AS nanos FROM "`+cfg.database()+`"."`+cfg.LogsTableName+`"`)
	require.Len(t, rows, 1)
	require.Equal(t, strconv.FormatInt(roundTripTime.UnixNano(), 10), rows[0]["nanos"])
}

func TestChDBRoundTripKeepsSpanTimestampNanoseconds(t *testing.T) {
	handle := openRealChDB(t)
	cfg := withDefaultConfig()
	exp := newTracesExporter(zaptest.NewLogger(t), cfg, handle)
	require.NoError(t, exp.start(t.Context(), nil))
	t.Cleanup(func() { _ = exp.shutdown(context.Background()) })

	td := ptrace.NewTraces()
	span := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.SetName("round trip")
	span.SetTraceID([16]byte{1})
	span.SetSpanID([8]byte{1})
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(roundTripTime))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(roundTripTime.Add(time.Second)))
	require.NoError(t, exp.pushTraceData(t.Context(), td))

	rows := queryJSONRows(t, handle,
		`SELECT toString(toUnixTimestamp64Nano(Timestamp)) AS nanos FROM "`+cfg.database()+`"."`+cfg.TracesTableName+`"`)
	require.Len(t, rows, 1)
	require.Equal(t, strconv.FormatInt(roundTripTime.UnixNano(), 10), rows[0]["nanos"])
}

type stampedDataPoint interface {
	SetStartTimestamp(pcommon.Timestamp)
	SetTimestamp(pcommon.Timestamp)
}

func stamp(dp stampedDataPoint) {
	dp.SetStartTimestamp(pcommon.NewTimestampFromTime(roundTripStartTime))
	dp.SetTimestamp(pcommon.NewTimestampFromTime(roundTripTime))
}

func addExemplar(exemplars pmetric.ExemplarSlice) {
	exemplar := exemplars.AppendEmpty()
	exemplar.SetTimestamp(pcommon.NewTimestampFromTime(roundTripExemplar))
	exemplar.SetDoubleValue(1)
}

func oneMetricOfEachType() pmetric.Metrics {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "round-trip")
	sm := rm.ScopeMetrics().AppendEmpty()
	sm.Scope().SetName("round-trip")

	gauge := sm.Metrics().AppendEmpty()
	gauge.SetName("gauge")
	gaugePoint := gauge.SetEmptyGauge().DataPoints().AppendEmpty()
	gaugePoint.SetDoubleValue(1)
	stamp(gaugePoint)
	addExemplar(gaugePoint.Exemplars())

	sum := sm.Metrics().AppendEmpty()
	sum.SetName("sum")
	sumPoint := sum.SetEmptySum().DataPoints().AppendEmpty()
	sumPoint.SetDoubleValue(1)
	stamp(sumPoint)
	addExemplar(sumPoint.Exemplars())

	histogram := sm.Metrics().AppendEmpty()
	histogram.SetName("histogram")
	histogramPoint := histogram.SetEmptyHistogram().DataPoints().AppendEmpty()
	histogramPoint.SetCount(1)
	histogramPoint.SetSum(1)
	histogramPoint.BucketCounts().FromRaw([]uint64{1})
	stamp(histogramPoint)
	addExemplar(histogramPoint.Exemplars())

	exponential := sm.Metrics().AppendEmpty()
	exponential.SetName("exponential_histogram")
	exponentialPoint := exponential.SetEmptyExponentialHistogram().DataPoints().AppendEmpty()
	exponentialPoint.SetCount(1)
	exponentialPoint.SetSum(1)
	stamp(exponentialPoint)
	addExemplar(exponentialPoint.Exemplars())

	summary := sm.Metrics().AppendEmpty()
	summary.SetName("summary")
	summaryPoint := summary.SetEmptySummary().DataPoints().AppendEmpty()
	summaryPoint.SetCount(1)
	summaryPoint.SetSum(1)
	stamp(summaryPoint)

	return md
}
