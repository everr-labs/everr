package everrusagereceiver

import (
	"context"
	"errors"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"testing"
	"time"

	"github.com/everr-labs/everr/collector/extension/everrusageextension"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/extension/extensiontest"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.uber.org/zap"
)

func TestFailedSubmissionIsNotRecreated(t *testing.T) {
	f := everrusageextension.NewFactory()
	cfg := f.CreateDefaultConfig().(*everrusageextension.Config)
	ext, err := f.Create(context.Background(), extensiontest.NewNopSettings(f.Type()), cfg)
	require.NoError(t, err)
	meter := ext.(*everrusageextension.Meter)
	meter.Record("logs", map[string]int64{"a": 123})
	var attempts []pmetric.Metrics
	next, err := consumer.NewMetrics(func(_ context.Context, md pmetric.Metrics) error {
		copy := pmetric.NewMetrics()
		md.CopyTo(copy)
		attempts = append(attempts, copy)
		if len(attempts) == 1 {
			return errors.New("queue admission returned an ambiguous error")
		}
		return nil
	})
	require.NoError(t, err)
	r := publisher{cfg: *NewFactory().CreateDefaultConfig().(*Config), next: next, logger: zap.NewNop(), meter: meter}
	r.flush(context.Background())
	r.flush(context.Background())
	require.Len(t, attempts, 1, "the receiver submits a drained snapshot only once; exporter retries retain its identity")
	owner, _ := attempts[0].ResourceMetrics().At(0).Resource().Attributes().Get(everrusageextension.TenantKey)
	require.Equal(t, "a", owner.Str())
	meter.Record("logs", map[string]int64{"a": 20})
	r.flush(context.Background())
	require.Len(t, attempts, 2)
	require.Equal(t, int64(20), attempts[1].ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0).IntValue())
}

type usageHost map[component.ID]component.Component

func (h usageHost) GetExtensions() map[component.ID]component.Component { return h }

func TestShutdownFlushBoundary(t *testing.T) {
	f := everrusageextension.NewFactory()
	ext, err := f.Create(t.Context(), extensiontest.NewNopSettings(f.Type()), f.CreateDefaultConfig())
	require.NoError(t, err)
	meter := ext.(*everrusageextension.Meter)
	sink := new(consumertest.MetricsSink)
	cfg := *NewFactory().CreateDefaultConfig().(*Config)
	cfg.Interval = time.Hour // Only shutdown, not a periodic tick, can publish.
	r := publisher{cfg: cfg, next: sink, logger: zap.NewNop()}
	require.NoError(t, r.Start(t.Context(), usageHost{component.NewID(f.Type()): ext}))
	meter.Record("logs", map[string]int64{"a": 200})
	require.NoError(t, r.Shutdown(t.Context()))
	require.Equal(t, 1, sink.DataPointCount())
	require.Equal(t, int64(200), sink.AllMetrics()[0].ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0).IntValue())

	// Independent ingestion pipelines can finish admission after this receiver
	// stops. That late accounting remains in memory and has no publisher.
	meter.Record("logs", map[string]int64{"a": 100})
	require.Equal(t, 1, sink.DataPointCount())
	pending := meter.Drain()
	require.Equal(t, int64(100), pending.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0).IntValue())
}
