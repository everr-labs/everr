package everrusageprocessor

import (
	"context"
	"errors"

	"github.com/everr-labs/everr/collector/extension/everrusageextension"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/consumer/xconsumer"
	"go.opentelemetry.io/collector/processor"
	"go.opentelemetry.io/collector/processor/xprocessor"
)

type Config struct {
	Extension component.ID `mapstructure:"extension"`
}

func (c *Config) Validate() error {
	if c.Extension.Type().String() != everrusageextension.Type {
		return errors.New("extension must reference an everr_usage extension")
	}
	return nil
}

func NewFactory() processor.Factory {
	return xprocessor.NewFactory(component.MustNewType(everrusageextension.Type), func() component.Config {
		return &Config{Extension: component.NewID(component.MustNewType(everrusageextension.Type))}
	},
		xprocessor.WithLogs(func(_ context.Context, _ processor.Settings, c component.Config, next consumer.Logs) (processor.Logs, error) {
			return &metering{cfg: *c.(*Config), logs: next}, nil
		}, component.StabilityLevelDevelopment),
		xprocessor.WithTraces(func(_ context.Context, _ processor.Settings, c component.Config, next consumer.Traces) (processor.Traces, error) {
			return &metering{cfg: *c.(*Config), traces: next}, nil
		}, component.StabilityLevelDevelopment),
		xprocessor.WithMetrics(func(_ context.Context, _ processor.Settings, c component.Config, next consumer.Metrics) (processor.Metrics, error) {
			return &metering{cfg: *c.(*Config), metrics: next}, nil
		}, component.StabilityLevelDevelopment),
		xprocessor.WithProfiles(func(_ context.Context, _ processor.Settings, c component.Config, next xconsumer.Profiles) (xprocessor.Profiles, error) {
			return &metering{cfg: *c.(*Config), profiles: next}, nil
		}, component.StabilityLevelDevelopment))
}

type metering struct {
	component.ShutdownFunc
	cfg      Config
	meter    *everrusageextension.Meter
	logs     consumer.Logs
	traces   consumer.Traces
	metrics  consumer.Metrics
	profiles xconsumer.Profiles
}

func (p *metering) Start(_ context.Context, host component.Host) error {
	var err error
	p.meter, err = everrusageextension.Lookup(host, p.cfg.Extension)
	return err
}
func (*metering) Capabilities() consumer.Capabilities {
	return consumer.Capabilities{MutatesData: false}
}
