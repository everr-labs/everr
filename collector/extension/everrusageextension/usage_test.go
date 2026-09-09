package everrusageextension

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.uber.org/zap"
)

func TestDrainContract(t *testing.T) {
	m := newMeter(Config{MaxSeries: 10}, zap.NewNop())
	m.Record("logs", map[string]int64{"customer": 123, "other": 50})
	md := m.Drain()
	require.Equal(t, 2, md.DataPointCount(), "exactly one customer-owned point per tenant/signal")
	for i, rm := range md.ResourceMetrics().All() {
		owner, _ := rm.Resource().Attributes().Get(TenantKey)
		require.Equal(t, []string{"customer", "other"}[i], owner.Str())
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
		require.Equal(t, []int64{123, 50}[i], point.IntValue())
		require.Equal(t, map[string]any{"everr.ingestion.signal": "logs", "everr.usage.tenant.id": owner.Str()}, point.Attributes().AsRaw())
		require.NotZero(t, point.StartTimestamp())
		require.GreaterOrEqual(t, point.Timestamp(), point.StartTimestamp())
	}
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
				m.Record("logs", map[string]int64{"a": 1})
			}
		}()
	}
	var sum int64
	for range 10 {
		md := m.Drain()
		sum += totalValue(md)
	}
	wg.Wait()
	md := m.Drain()
	sum += totalValue(md)
	require.Equal(t, int64(800), sum)
	m.Record("logs", map[string]int64{"a": maxBytes})
	m.Record("logs", map[string]int64{"a": 1, "b": 5})
	md = m.Drain()
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
