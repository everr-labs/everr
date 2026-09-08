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
	"go.uber.org/zap"
)

func TestFailedPublicationIsNeverReplayed(t *testing.T) {
	f := usage.NewFactory()
	cfg := f.CreateDefaultConfig().(*usage.Config)
	cfg.InternalTenant = "operator"
	ext, err := f.Create(context.Background(), extensiontest.NewNopSettings(f.Type()), cfg)
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
	require.Len(t, attempts, 2, "customer failure must neither replay nor prevent the internal attempt")
	owner, _ := attempts[1].ResourceMetrics().At(0).Resource().Attributes().Get(usage.TenantKey)
	require.Equal(t, "operator", owner.Str())
	meter.Record("logs", map[string]int64{"a": 20})
	r.flush(context.Background())
	require.Len(t, attempts, 4)
	require.Equal(t, int64(20), attempts[2].ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0).IntValue())
}
