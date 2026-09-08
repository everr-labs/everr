package usagereceiver

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/everr-labs/everr/collector/usage"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/receiver"
	"go.uber.org/zap"
)

type Config struct {
	Extension component.ID  `mapstructure:"extension"`
	Interval  time.Duration `mapstructure:"interval"`
	Timeout   time.Duration `mapstructure:"timeout"`
}

func (c *Config) Validate() error {
	if c.Extension.Type().String() != usage.Type || c.Interval <= 0 || c.Timeout <= 0 {
		return errors.New("usage receiver requires an everr_usage extension and positive interval and timeout")
	}
	return nil
}
func NewFactory() receiver.Factory {
	return receiver.NewFactory(component.MustNewType(usage.Type), func() component.Config {
		return &Config{
			Extension: component.NewID(component.MustNewType(usage.Type)), Interval: time.Minute, Timeout: 10 * time.Second,
		}
	}, receiver.WithMetrics(func(_ context.Context, set receiver.Settings, cfg component.Config, next consumer.Metrics) (receiver.Metrics, error) {
		return &publisher{cfg: *cfg.(*Config), next: next, logger: set.Logger}, nil
	}, component.StabilityLevelDevelopment))
}

type publisher struct {
	cfg    Config
	next   consumer.Metrics
	logger *zap.Logger
	meter  *usage.Meter
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func (r *publisher) Start(_ context.Context, host component.Host) error {
	var err error
	r.meter, err = usage.Lookup(host, r.cfg.Extension)
	if err != nil {
		return err
	}
	if err = r.meter.ClaimPublisher(); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ticker := time.NewTicker(r.cfg.Interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.flush(ctx)
			}
		}
	}()
	return nil
}
func (r *publisher) Shutdown(ctx context.Context) error {
	if r.cancel == nil {
		return nil
	}
	r.cancel()
	r.wg.Wait()
	r.flush(ctx)
	return nil
}
func (r *publisher) flush(ctx context.Context) {
	customer, internal := r.meter.Drain()
	for _, md := range []pmetric.Metrics{customer, internal} {
		if md.DataPointCount() == 0 {
			continue
		}
		attempt, cancel := context.WithTimeout(ctx, r.cfg.Timeout)
		err := r.next.ConsumeMetrics(attempt, md)
		cancel()
		if err != nil {
			r.logger.Error("Usage publication failed; snapshot discarded", zap.Error(err))
		}
	}
}
