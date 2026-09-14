package everrusageextension

import (
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pipeline"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.uber.org/zap"
)

func TestDrainContract(t *testing.T) {
	m := newMeter(Config{MaxSeries: 10}, zap.NewNop())
	m.Record(pipeline.SignalLogs, map[string]int64{"customer": 123, "other": 50})
	md := m.Drain()
	require.Equal(t, 2, md.DataPointCount(), "exactly one customer-owned point per tenant/signal")
	expected := map[string]int64{"customer": 123, "other": 50}
	for _, rm := range md.ResourceMetrics().All() {
		owner, _ := rm.Resource().Attributes().Get(TenantKey)
		require.Contains(t, expected, owner.Str())
		retention, _ := rm.Resource().Attributes().Get(RetentionKey)
		require.Equal(t, "365", retention.Str())
		instance, _ := rm.Resource().Attributes().Get("service.instance.id")
		require.NotEmpty(t, instance.Str())
		service, _ := rm.Resource().Attributes().Get("service.name")
		require.Equal(t, "everr-ingestion", service.Str())
		metric := rm.ScopeMetrics().At(0).Metrics().At(0)
		require.Equal(t, MetricName, metric.Name())
		require.Equal(t, "By", metric.Unit())
		require.True(t, metric.Sum().IsMonotonic())
		require.Equal(t, pmetric.AggregationTemporalityDelta, metric.Sum().AggregationTemporality())
		point := metric.Sum().DataPoints().At(0)
		require.Equal(t, expected[owner.Str()], point.IntValue())
		delete(expected, owner.Str())
		require.Equal(t, map[string]any{"everr.ingestion.signal": "logs", "everr.usage.tenant.id": owner.Str(), MonthKey: point.StartTimestamp().AsTime().UTC().Format("2006-01"), GenerationKey: "0"}, point.Attributes().AsRaw())
		require.NotZero(t, point.StartTimestamp())
		require.GreaterOrEqual(t, point.Timestamp(), point.StartTimestamp())
		require.Equal(t, point.Attributes().AsRaw()[MonthKey], point.Timestamp().AsTime().UTC().Format("2006-01"))
	}
	require.Empty(t, expected)
	require.Zero(t, m.Drain().DataPointCount())
}

func TestConcurrentDrainAndBounds(t *testing.T) {
	m := newMeter(Config{MaxSeries: 1}, zap.NewNop())
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 100 {
				m.Record(pipeline.SignalLogs, map[string]int64{"a": 1})
			}
		}()
	}
	var sum int64
	var last pcommon.Timestamp
	consume := func(md pmetric.Metrics) {
		sum += totalValue(md)
		if md.DataPointCount() == 0 {
			return
		}
		point := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
		require.Greater(t, point.Timestamp(), last)
		require.Equal(t, point.Attributes().AsRaw()[MonthKey], point.Timestamp().AsTime().UTC().Format("2006-01"))
		last = point.Timestamp()
	}
	for range 10 {
		consume(m.Drain())
	}
	wg.Wait()
	consume(m.Drain())
	require.Equal(t, int64(800), sum)
	m.Record(pipeline.SignalLogs, map[string]int64{"a": maxBytes})
	m.Record(pipeline.SignalLogs, map[string]int64{"a": 1, "b": 5})
	md := m.Drain()
	require.Equal(t, maxBytes, totalValue(md))
	require.Equal(t, 1, md.DataPointCount())
	require.NoError(t, m.ClaimPublisher())
	require.Error(t, m.ClaimPublisher())
}

func totalValue(md pmetric.Metrics) int64 {
	var n int64
	for _, rm := range md.ResourceMetrics().All() {
		for _, sm := range rm.ScopeMetrics().All() {
			for _, m := range sm.Metrics().All() {
				for _, p := range m.Sum().DataPoints().All() {
					n += p.IntValue()
				}
			}
		}
	}
	return n
}

func TestMonthRolloverWithinOneFlush(t *testing.T) {
	m := newMeter(Config{MaxSeries: 10}, zap.NewNop())
	before := time.Date(2026, 9, 30, 23, 59, 59, 0, time.UTC)
	after := before.Add(time.Second)
	m.recordAt(pipeline.SignalLogs, map[string]int64{"a": 200}, before)
	m.recordAt(pipeline.SignalLogs, map[string]int64{"a": 300}, after)
	md := m.Drain()
	require.Equal(t, 2, md.DataPointCount())
	expected := map[string]struct {
		bytes int64
		end   time.Time
	}{"2026-09": {200, before}, "2026-10": {300, after}}
	for _, rm := range md.ResourceMetrics().All() {
		point := rm.ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
		month := point.Attributes().AsRaw()[MonthKey].(string)
		require.Contains(t, expected, month)
		require.Equal(t, expected[month].bytes, point.IntValue())
		require.Equal(t, expected[month].end, point.Timestamp().AsTime())
		delete(expected, month)
	}
	require.Empty(t, expected)
	restarted := newMeter(Config{MaxSeries: 10}, zap.NewNop())
	require.NotEqual(t, m.instance, restarted.instance)
}

func TestMonthUsesUTC(t *testing.T) {
	m := newMeter(Config{MaxSeries: 10}, zap.NewNop())
	admitted := time.Date(2026, 10, 1, 1, 0, 0, 0, time.FixedZone("east", 2*60*60))
	m.recordAt(pipeline.SignalLogs, map[string]int64{"a": 200}, admitted)
	point := m.Drain().ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
	require.Equal(t, "2026-09", point.Attributes().AsRaw()[MonthKey])
	require.True(t, admitted.Equal(point.Timestamp().AsTime()))
}

func TestClockCorrectionAcrossMonth(t *testing.T) {
	for _, tenant := range []string{"a", "b"} {
		t.Run(tenant, func(t *testing.T) {
			m := newMeter(Config{MaxSeries: 10}, zap.NewNop())
			m.recordAt(pipeline.SignalLogs, map[string]int64{"a": 100}, time.Date(2026, 10, 1, 0, 0, 1, 0, time.UTC))
			m.Drain()
			corrected := time.Date(2026, 9, 30, 23, 59, 59, 0, time.UTC)
			m.recordAt(pipeline.SignalLogs, map[string]int64{tenant: 200}, corrected)
			point := m.Drain().ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
			require.Equal(t, "2026-09", point.Attributes().AsRaw()[MonthKey])
			require.Equal(t, corrected, point.Timestamp().AsTime())
		})
	}
}

func TestAdmissionClockPreservesWallTime(t *testing.T) {
	m := newMeter(Config{MaxSeries: 10}, zap.NewNop())
	first := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	times := []time.Time{first, first, first.Add(-time.Hour)}
	m.now = func() time.Time {
		now := times[0]
		times = times[1:]
		return now
	}

	for _, admitted := range []time.Time{first, first, first.Add(-time.Hour)} {
		m.Record(pipeline.SignalLogs, map[string]int64{"a": 100})
		point := m.Drain().ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
		require.Equal(t, admitted, point.Timestamp().AsTime())
		require.Equal(t, "2026-09", point.Attributes().AsRaw()[MonthKey])
	}
}

func TestClockGenerationIgnoresUnrecordedMeasurements(t *testing.T) {
	m := newMeter(Config{MaxSeries: 1}, zap.NewNop())
	at := time.Date(2026, 9, 30, 23, 59, 59, 0, time.UTC)
	m.recordAt(pipeline.SignalLogs, map[string]int64{"a": 100}, at)
	for _, measurements := range []map[string]int64{nil, {"a": 0}, {"a": -1}, {"a": maxBytes}, {"b": 100}} {
		m.recordAt(pipeline.SignalLogs, measurements, at.Add(-time.Second))
		require.Equal(t, uint64(0), m.generation)
		require.Equal(t, pcommon.NewTimestampFromTime(at), m.lastAdmission)
	}
}

func TestClockGenerationsRemainSeparateWithinFlush(t *testing.T) {
	m := newMeter(Config{MaxSeries: 10}, zap.NewNop())
	at := time.Date(2026, 9, 30, 23, 59, 59, 999999999, time.UTC)
	for range 3 {
		m.recordAt(pipeline.SignalLogs, map[string]int64{"a": 100}, at)
	}
	md := m.Drain()
	require.Equal(t, 3, md.DataPointCount())
	require.Equal(t, int64(300), totalValue(md))
	generations := map[string]bool{}
	for _, rm := range md.ResourceMetrics().All() {
		point := rm.ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
		require.Equal(t, at, point.Timestamp().AsTime())
		require.Equal(t, "2026-09", point.Attributes().AsRaw()[MonthKey])
		generation := point.Attributes().AsRaw()[GenerationKey].(string)
		require.False(t, generations[generation])
		generations[generation] = true
	}
}

func TestUnsupportedSignalsAreNotPublished(t *testing.T) {
	m := newMeter(Config{MaxSeries: 10}, zap.NewNop())
	var profiles pipeline.Signal
	require.NoError(t, profiles.UnmarshalText([]byte("profiles")))
	for _, signal := range []pipeline.Signal{{}, profiles} {
		m.Record(signal, map[string]int64{"a": 100})
	}
	require.Zero(t, m.Drain().DataPointCount())
	for _, signal := range []pipeline.Signal{pipeline.SignalLogs, pipeline.SignalTraces, pipeline.SignalMetrics} {
		m.Record(signal, map[string]int64{"a": 100})
	}
	require.Equal(t, 3, m.Drain().DataPointCount())
}
