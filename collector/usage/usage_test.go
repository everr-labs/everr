package usage

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.uber.org/zap"
)

func TestDrainContract(t *testing.T) {
	m := newMeter(Config{InternalTenant: "operator", RetentionDays: 90, MaxSeries: 10}, zap.NewNop())
	m.Record("logs", map[string]int64{"customer": 123})
	customer, internal := m.Drain()
	for i, md := range []pmetric.Metrics{customer, internal} {
		require.Equal(t, 1, md.DataPointCount())
		rm := md.ResourceMetrics().At(0)
		owner, _ := rm.Resource().Attributes().Get(TenantKey)
		require.Equal(t, []string{"customer", "operator"}[i], owner.Str())
		retention, _ := rm.Resource().Attributes().Get(RetentionKey)
		require.Equal(t, "90", retention.Str())
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
		require.Equal(t, int64(123), point.IntValue())
		require.Equal(t, map[string]any{"everr.ingestion.signal": "logs", "everr.usage.tenant.id": "customer"}, point.Attributes().AsRaw())
		require.NotZero(t, point.StartTimestamp())
		require.GreaterOrEqual(t, point.Timestamp(), point.StartTimestamp())
	}
	a := customer.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
	b := internal.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
	require.Equal(t, a.StartTimestamp(), b.StartTimestamp())
	require.Equal(t, a.Timestamp(), b.Timestamp())
	customer, internal = m.Drain()
	require.Zero(t, customer.DataPointCount())
	require.Zero(t, internal.DataPointCount())
	m.Record("logs", map[string]int64{"operator": 50})
	customer, internal = m.Drain()
	require.Equal(t, 1, customer.DataPointCount())
	require.Zero(t, internal.DataPointCount(), "internal tenant must not receive its own usage twice")
}

func TestConcurrentDrainAndBounds(t *testing.T) {
	m := newMeter(Config{MaxSeries: 1, RetentionDays: 1}, zap.NewNop())
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
		md, _ := m.Drain()
		sum += totalValue(md)
	}
	wg.Wait()
	md, _ := m.Drain()
	sum += totalValue(md)
	require.Equal(t, int64(800), sum)
	m.Record("logs", map[string]int64{"a": maxBytes})
	m.Record("logs", map[string]int64{"a": 1, "b": 5})
	md, _ = m.Drain()
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
