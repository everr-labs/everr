package usagereceiver

import (
	"context"
	"errors"
	"testing"

	"github.com/everr-labs/everr/collector/usage"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/extension/extensiontest"
	"go.opentelemetry.io/collector/pdata/pmetric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap"
)

func TestFailedPublicationIsNeverReplayed(t *testing.T) {
	f := usage.NewFactory()
	cfg := f.CreateDefaultConfig().(*usage.Config)
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	t.Cleanup(func() { require.NoError(t, provider.Shutdown(context.Background())) })
	settings := extensiontest.NewNopSettings(f.Type())
	settings.MeterProvider = provider
	ext, err := f.Create(context.Background(), settings, cfg)
	require.NoError(t, err)
	meter := ext.(*usage.Meter)
	meter.Record("logs", map[string]int64{"a": 123})
	var attempts []pmetric.Metrics
	next, err := consumer.NewMetrics(func(_ context.Context, md pmetric.Metrics) error {
		copy := pmetric.NewMetrics()
		md.CopyTo(copy)
		attempts = append(attempts, copy)
		if len(attempts) == 1 {
			return errors.New("write committed but acknowledgement lost")
		}
		return nil
	})
	require.NoError(t, err)
	r := publisher{cfg: *NewFactory().CreateDefaultConfig().(*Config), next: next, logger: zap.NewNop(), meter: meter}
	r.flush(context.Background())
	r.flush(context.Background())
	require.Len(t, attempts, 1, "failed or ambiguous usage must never be replayed")
	owner, _ := attempts[0].ResourceMetrics().At(0).Resource().Attributes().Get(usage.TenantKey)
	require.Equal(t, "a", owner.Str())
	meter.Record("logs", map[string]int64{"a": 20})
	r.flush(context.Background())
	require.Len(t, attempts, 2)
	require.Equal(t, int64(20), attempts[1].ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0).IntValue())
	var out metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &out))
	require.Len(t, out.ScopeMetrics, 1)
	require.Len(t, out.ScopeMetrics[0].Metrics, 1)
	health := out.ScopeMetrics[0].Metrics[0]
	require.Equal(t, "everr.usage.publication.failed", health.Name)
	require.Equal(t, "1", health.Unit)
	sum, ok := health.Data.(metricdata.Sum[int64])
	require.True(t, ok)
	require.True(t, sum.IsMonotonic)
	require.Equal(t, metricdata.CumulativeTemporality, sum.Temporality)
	require.Len(t, sum.DataPoints, 1)
	require.Equal(t, int64(1), sum.DataPoints[0].Value, "empty flushes and successful publication must not count as failures")
	require.Zero(t, sum.DataPoints[0].Attributes.Len())
}
