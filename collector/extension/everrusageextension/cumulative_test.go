package everrusageextension

import (
	"testing"
	"time"

	"github.com/open-telemetry/opentelemetry-collector-contrib/processor/deltatocumulativeprocessor"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component/componenttest"
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
