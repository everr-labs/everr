package everrusageconnector

import (
	"context"
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/everr-labs/everr/collector/extension/everrusageextension"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/connector/connectortest"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"go.opentelemetry.io/collector/extension/extensiontest"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
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
	require.Len(t, attempts, 1, "the connector submits a drained snapshot only once; exporter retries retain its identity")
	owner, _ := attempts[0].ResourceMetrics().At(0).Resource().Attributes().Get(everrusageextension.TenantKey)
	require.Equal(t, "a", owner.Str())
	meter.Record("logs", map[string]int64{"a": 20})
	r.flush(context.Background())
	require.Len(t, attempts, 2)
	require.Equal(t, int64(20), attempts[1].ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0).IntValue())
}

type usageHost map[component.ID]component.Component

func (h usageHost) GetExtensions() map[component.ID]component.Component { return h }

func TestLastInputFlushes(t *testing.T) {
	f := everrusageextension.NewFactory()
	ext, err := f.Create(t.Context(), extensiontest.NewNopSettings(f.Type()), f.CreateDefaultConfig())
	require.NoError(t, err)
	meter := ext.(*everrusageextension.Meter)
	sink := new(consumertest.MetricsSink)
	factory := NewFactory()
	cfg := factory.CreateDefaultConfig().(*Config)
	cfg.Interval = time.Hour
	set := connectortest.NewNopSettings(factory.Type())
	logs, err := factory.CreateLogsToMetrics(t.Context(), set, cfg, sink)
	require.NoError(t, err)
	traces, err := factory.CreateTracesToMetrics(t.Context(), set, cfg, sink)
	require.NoError(t, err)
	metrics, err := factory.CreateMetricsToMetrics(t.Context(), set, cfg, sink)
	require.NoError(t, err)
	host := usageHost{component.NewID(f.Type()): ext}
	for _, c := range []component.Component{logs, traces, metrics} {
		require.NoError(t, c.Start(t.Context(), host))
	}
	require.NoError(t, logs.ConsumeLogs(t.Context(), plog.NewLogs()))
	require.NoError(t, traces.ConsumeTraces(t.Context(), ptrace.NewTraces()))
	require.NoError(t, metrics.ConsumeMetrics(t.Context(), pmetric.NewMetrics()))
	require.Zero(t, meter.Drain().DataPointCount(), "connector input never meters or forwards source payloads")
	meter.Record("logs", map[string]int64{"a": 200})
	require.NoError(t, logs.Shutdown(t.Context()))
	require.NoError(t, logs.Shutdown(t.Context())) // A repeated stop cannot decrement twice.
	require.Zero(t, sink.DataPointCount())
	meter.Record("logs", map[string]int64{"a": 100})
	require.NoError(t, traces.Shutdown(t.Context()))
	require.Zero(t, sink.DataPointCount())
	require.NoError(t, metrics.Shutdown(t.Context()))
	require.Equal(t, int64(300), sink.AllMetrics()[0].ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0).IntValue())
	require.Zero(t, meter.Drain().DataPointCount())
}

// Stop the run loop while a periodic publication is still being admitted.
// A pending tick also competes with cancellation when that attempt completes.
func TestShutdownDoesNotCancelPeriodicPublication(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		f := everrusageextension.NewFactory()
		ext, err := f.Create(t.Context(), extensiontest.NewNopSettings(f.Type()), f.CreateDefaultConfig())
		require.NoError(t, err)
		meter := ext.(*everrusageextension.Meter)
		started := make(chan context.Context, 1)
		release := make(chan struct{})
		var published []int64
		next, err := consumer.NewMetrics(func(ctx context.Context, md pmetric.Metrics) error {
			if len(published) == 0 {
				started <- ctx
				<-release
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			published = append(published, md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0).IntValue())
			return nil
		})
		require.NoError(t, err)
		cfg := *NewFactory().CreateDefaultConfig().(*Config)
		cfg.Interval = time.Second
		r := anchor{p: &publisher{cfg: cfg, next: next, logger: zap.NewNop(), remaining: 1, release: func() {}}}
		require.NoError(t, r.Start(t.Context(), usageHost{component.NewID(f.Type()): ext}))
		meter.Record("logs", map[string]int64{"a": 200})
		attempt := <-started
		meter.Record("logs", map[string]int64{"a": 100})
		time.Sleep(cfg.Interval) // Leave another tick pending.
		stopped := make(chan error, 1)
		go func() { stopped <- r.Shutdown(t.Context()) }()
		synctest.Wait()
		attemptErr := attempt.Err()
		close(release)
		require.NoError(t, <-stopped)
		require.NoError(t, attemptErr, "stopping ticks must not cancel publication")
		require.Equal(t, []int64{200, 100}, published)
		require.Zero(t, meter.Drain().DataPointCount())
	})
}

func TestPeriodicPublicationRemainsBoundedDuringShutdown(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		f := everrusageextension.NewFactory()
		ext, err := f.Create(t.Context(), extensiontest.NewNopSettings(f.Type()), f.CreateDefaultConfig())
		require.NoError(t, err)
		meter := ext.(*everrusageextension.Meter)
		started := make(chan struct{})
		finished := make(chan error, 1)
		next, err := consumer.NewMetrics(func(ctx context.Context, _ pmetric.Metrics) error {
			close(started)
			<-ctx.Done()
			finished <- ctx.Err()
			return ctx.Err()
		})
		require.NoError(t, err)
		cfg := *NewFactory().CreateDefaultConfig().(*Config)
		cfg.Interval = time.Second
		cfg.Timeout = 3 * time.Second
		r := anchor{p: &publisher{cfg: cfg, next: next, logger: zap.NewNop(), remaining: 1, release: func() {}}}
		require.NoError(t, r.Start(t.Context(), usageHost{component.NewID(f.Type()): ext}))
		meter.Record("logs", map[string]int64{"a": 200})
		<-started
		before := time.Now()
		require.NoError(t, r.Shutdown(t.Context()))
		require.ErrorIs(t, <-finished, context.DeadlineExceeded)
		require.Equal(t, cfg.Timeout, time.Since(before))
	})
}
