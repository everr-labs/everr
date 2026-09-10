package everrusageextension

import (
	"context"
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/open-telemetry/opentelemetry-collector-contrib/processor/deltatocumulativeprocessor"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/processor/processortest"
	"go.uber.org/zap"
)

func TestNativeCumulativeMonthlyStreams(t *testing.T) {
	sink := new(consumertest.MetricsSink)
	factory := deltatocumulativeprocessor.NewFactory()
	proc, err := factory.CreateMetrics(t.Context(), processortest.NewNopSettings(factory.Type()), factory.CreateDefaultConfig(), sink)
	require.NoError(t, err)
	require.NoError(t, proc.Start(t.Context(), componenttest.NewNopHost()))
	t.Cleanup(func() { require.NoError(t, proc.Shutdown(t.Context())) })
	meter := newMeter(Config{MaxSeries: 10}, zap.NewNop())
	september := time.Date(2026, 9, 30, 23, 58, 0, 0, time.UTC)
	meter.recordAt("logs", map[string]int64{"a": 200}, september)
	require.NoError(t, proc.ConsumeMetrics(t.Context(), meter.drainAt(september.Add(time.Minute))))
	// One flush spans the UTC boundary: these must remain different streams.
	meter.recordAt("logs", map[string]int64{"a": 200}, september.Add(90*time.Second))
	meter.recordAt("logs", map[string]int64{"a": 300}, september.Add(2*time.Minute))
	require.NoError(t, proc.ConsumeMetrics(t.Context(), meter.drainAt(september.Add(3*time.Minute))))
	md := sink.AllMetrics()[1]
	require.Equal(t, 2, md.DataPointCount())
	expected := map[string]struct {
		bytes int64
		start time.Time
	}{
		"2026-09": {400, september},
		"2026-10": {300, september.Add(2 * time.Minute)},
	}
	for _, rm := range md.ResourceMetrics().All() {
		sum := rm.ScopeMetrics().At(0).Metrics().At(0).Sum()
		require.Equal(t, pmetric.AggregationTemporalityCumulative, sum.AggregationTemporality())
		point := sum.DataPoints().At(0)
		month := point.Attributes().AsRaw()[MonthKey].(string)
		require.Contains(t, expected, month)
		require.Equal(t, expected[month].bytes, point.IntValue())
		require.Equal(t, expected[month].start, point.StartTimestamp().AsTime())
		delete(expected, month)
	}
	require.Empty(t, expected)
}

// Exercise upstream's real one-minute cleanup ticker with virtual time.
func TestRejectedFinalSnapshotIsLostAfterIdleExpiry(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sink := new(consumertest.MetricsSink)
		reject := false
		next, err := consumer.NewMetrics(func(ctx context.Context, md pmetric.Metrics) error {
			if reject {
				return errors.New("usage queue full")
			}
			return sink.ConsumeMetrics(ctx, md)
		})
		require.NoError(t, err)
		factory := deltatocumulativeprocessor.NewFactory()
		cfg := factory.CreateDefaultConfig().(*deltatocumulativeprocessor.Config)
		cfg.MaxStale = 5 * time.Minute
		proc, err := factory.CreateMetrics(t.Context(), processortest.NewNopSettings(factory.Type()), cfg, next)
		require.NoError(t, err)
		require.NoError(t, proc.Start(t.Context(), componenttest.NewNopHost()))
		defer func() { require.NoError(t, proc.Shutdown(context.Background())) }()
		meter := newMeter(Config{MaxSeries: 10}, zap.NewNop())
		publish := func(bytes int64) error {
			meter.Record("logs", map[string]int64{"a": bytes})
			return proc.ConsumeMetrics(t.Context(), meter.Drain())
		}
		require.NoError(t, publish(200))
		time.Sleep(time.Minute)
		reject = true
		require.Error(t, publish(200))
		reject = false
		time.Sleep(7 * time.Minute)
		synctest.Wait()
		require.Len(t, sink.AllMetrics(), 1, "idle counters do not republish a failed final snapshot")
		require.NoError(t, publish(200))
		stored := sink.AllMetrics()
		require.Len(t, stored, 2)
		first := stored[0].ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
		last := stored[1].ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
		require.NotEqual(t, first.StartTimestamp(), last.StartTimestamp())
		require.Equal(t, int64(200), first.IntValue())
		require.Equal(t, int64(200), last.IntValue())
		require.Equal(t, int64(400), first.IntValue()+last.IntValue(), "600 admitted bytes, but the unpublished 200 from the expired lifetime cannot be recovered")
	})
}
