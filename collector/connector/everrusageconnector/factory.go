// Package everrusageconnector publishes usage after its metered inputs stop.
package everrusageconnector

import (
	"context"
	"errors"
	"sync"
	"time"

	usage "github.com/everr-labs/everr/collector/extension/everrusageextension"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/connector"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap"
)

type Config struct {
	Extension component.ID  `mapstructure:"extension"`
	Interval  time.Duration `mapstructure:"interval"`
	Timeout   time.Duration `mapstructure:"timeout"`
}

func (c *Config) Validate() error {
	if c.Extension.Type().String() != usage.Type || c.Interval <= 0 || c.Timeout <= 0 {
		return errors.New("usage connector requires an everr_usage extension and positive interval and timeout")
	}
	return nil
}

type publisher struct {
	cfg       Config
	meter     *usage.Meter
	next      consumer.Metrics
	logger    *zap.Logger
	remaining int
	mu        sync.Mutex
	once      sync.Once
	startErr  error
	cancel    context.CancelFunc
	wg        sync.WaitGroup
	release   func()
}

// Each input signal has its own graph node, but shares one publisher.
type anchor struct {
	p    *publisher
	stop sync.Once
}

func (*anchor) Capabilities() consumer.Capabilities                   { return consumer.Capabilities{} }
func (*anchor) ConsumeLogs(context.Context, plog.Logs) error          { return nil }
func (*anchor) ConsumeTraces(context.Context, ptrace.Traces) error    { return nil }
func (*anchor) ConsumeMetrics(context.Context, pmetric.Metrics) error { return nil }
func (a *anchor) Start(_ context.Context, h component.Host) error {
	p := a.p
	p.once.Do(func() {
		p.meter, p.startErr = usage.Lookup(h, p.cfg.Extension)
		if p.startErr != nil {
			return
		}
		p.startErr = p.meter.ClaimPublisher()
		if p.startErr != nil {
			return
		}
		ctx, cancel := context.WithCancel(context.Background())
		p.cancel = cancel
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			ticker := time.NewTicker(p.cfg.Interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if ctx.Err() != nil {
						return
					}
					// Stopping ticks must not cancel an in-flight publication.
					p.flush(context.Background())
				}
			}
		}()
	})
	return p.startErr
}
func (p *publisher) flush(ctx context.Context) {
	md := p.meter.Drain()
	if md.DataPointCount() == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, p.cfg.Timeout)
	defer cancel()
	if err := p.next.ConsumeMetrics(ctx, md); err != nil {
		p.logger.Error("Usage publication failed; snapshot discarded", zap.Error(err))
	}
}
func (a *anchor) Shutdown(ctx context.Context) error {
	a.stop.Do(func() {
		p := a.p
		p.mu.Lock()
		p.remaining--
		last := p.remaining == 0
		p.mu.Unlock()
		if !last {
			return
		}
		defer p.release()
		if p.cancel == nil {
			return
		}
		// Collector stops upstream processors before their connector nodes. Only
		// the last input node may flush; the metrics output is still running here.
		p.cancel()
		p.wg.Wait()
		p.flush(ctx)
	})
	return nil
}
func NewFactory() connector.Factory {
	shared := map[*Config]*publisher{}
	var mu sync.Mutex
	create := func(set connector.Settings, c component.Config, next consumer.Metrics) *anchor {
		cfg := c.(*Config)
		mu.Lock()
		defer mu.Unlock()
		p := shared[cfg]
		if p == nil {
			p = &publisher{cfg: *cfg, next: next, logger: set.Logger}
			shared[cfg] = p
			p.release = func() { mu.Lock(); defer mu.Unlock(); delete(shared, cfg) }
		}
		p.mu.Lock()
		p.remaining++
		p.mu.Unlock()
		return &anchor{p: p}
	}
	return connector.NewFactory(component.MustNewType(usage.Type+"_connector"), func() component.Config {
		return &Config{Extension: component.MustNewID(usage.Type), Interval: time.Minute, Timeout: 10 * time.Second}
	},
		connector.WithLogsToMetrics(func(_ context.Context, s connector.Settings, c component.Config, n consumer.Metrics) (connector.Logs, error) {
			return create(s, c, n), nil
		}, component.StabilityLevelDevelopment),
		connector.WithTracesToMetrics(func(_ context.Context, s connector.Settings, c component.Config, n consumer.Metrics) (connector.Traces, error) {
			return create(s, c, n), nil
		}, component.StabilityLevelDevelopment),
		connector.WithMetricsToMetrics(func(_ context.Context, s connector.Settings, c component.Config, n consumer.Metrics) (connector.Metrics, error) {
			return create(s, c, n), nil
		}, component.StabilityLevelDevelopment))
}
