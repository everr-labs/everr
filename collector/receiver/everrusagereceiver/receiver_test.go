package everrusagereceiver

import (
	"context"
	"errors"
	"testing"

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
