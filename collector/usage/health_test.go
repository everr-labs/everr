package usage

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/extension/extensiontest"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestAccountingHealth(t *testing.T) {
	ctx := context.Background()
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	t.Cleanup(func() { require.NoError(t, provider.Shutdown(ctx)) })
	factory := NewFactory()
	settings := extensiontest.NewNopSettings(factory.Type())
	settings.MeterProvider = provider
	ext, err := factory.Create(ctx, settings, &Config{MaxSeries: 1})
	require.NoError(t, err)
	meter := ext.(*Meter)
	meter.Record("logs", map[string]int64{"customer": maxBytes})
	meter.Record("logs", map[string]int64{"customer": 7})
	meter.Record("traces", map[string]int64{"another-customer": 11})
	require.Equal(t, maxBytes, totalValue(meter.Drain()))
	require.Zero(t, meter.Drain().DataPointCount())
	// Draining billable usage must not reset cumulative operational counters.
	for range 2 {
		var out metricdata.ResourceMetrics
		require.NoError(t, reader.Collect(ctx, &out))
		require.Len(t, out.ScopeMetrics, 1)
		require.Len(t, out.ScopeMetrics[0].Metrics, 1)
		metric := out.ScopeMetrics[0].Metrics[0]
		require.Equal(t, discardedVolumeName, metric.Name)
		require.Equal(t, "By", metric.Unit)
		sum, ok := metric.Data.(metricdata.Sum[int64])
		require.True(t, ok)
		require.True(t, sum.IsMonotonic)
		require.Equal(t, metricdata.CumulativeTemporality, sum.Temporality)
		values := map[string]int64{}
		for _, point := range sum.DataPoints {
			require.Equal(t, 2, point.Attributes.Len(), "no customer identifiers in health metrics")
			reason, _ := point.Attributes.Value("everr.usage.discard.reason")
			signal, _ := point.Attributes.Value("everr.ingestion.signal")
			values[signal.AsString()+"/"+reason.AsString()] = point.Value
		}
		require.Equal(t, map[string]int64{"logs/value_limit": 7, "traces/series_limit": 11}, values)
	}
}
