// Package everrtelemetry enriches native receiver metrics with trusted tenant identity.
package everrtelemetry

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/service/telemetry"
	"go.opentelemetry.io/collector/service/telemetry/otelconftelemetry"
)

// NewFactory preserves the standard telemetry configuration and providers.
func NewFactory() telemetry.Factory {
	base := otelconftelemetry.NewFactory()
	return telemetry.NewFactory(base.CreateDefaultConfig,
		telemetry.WithCreateResource(base.CreateResource),
		telemetry.WithCreateLogger(base.CreateLogger),
		telemetry.WithCreateTracerProvider(base.CreateTracerProvider),
		telemetry.WithCreateMeterProvider(func(ctx context.Context, set telemetry.MeterSettings, cfg component.Config) (telemetry.MeterProvider, error) {
			provider, err := base.CreateMeterProvider(ctx, set, cfg)
			if err != nil {
				return nil, err
			}
			return &meterProvider{MeterProvider: provider}, nil
		}),
	)
}
