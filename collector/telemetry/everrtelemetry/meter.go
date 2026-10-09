package everrtelemetry

import (
	"context"

	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/service/telemetry"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// TenantKey identifies the authenticated customer measured by the counter.
const TenantKey = "everr.ingestion.tenant.id"
const receiverScope = "go.opentelemetry.io/collector/receiver/receiverhelper"

type meterProvider struct{ telemetry.MeterProvider }

func (p *meterProvider) Meter(name string, options ...metric.MeterOption) metric.Meter {
	meter := p.MeterProvider.Meter(name, options...)
	if name != receiverScope {
		return meter
	}
	return &tenantMeter{Meter: meter}
}

type tenantMeter struct{ metric.Meter }

func (m *tenantMeter) Int64Counter(name string, options ...metric.Int64CounterOption) (metric.Int64Counter, error) {
	counter, err := m.Meter.Int64Counter(name, options...)
	if err != nil {
		return nil, err
	}
	switch name {
	case "otelcol_receiver_accepted_spans", "otelcol_receiver_refused_spans",
		"otelcol_receiver_accepted_metric_points", "otelcol_receiver_refused_metric_points",
		"otelcol_receiver_accepted_log_records", "otelcol_receiver_refused_log_records",
		"otelcol_receiver_failed_spans", "otelcol_receiver_failed_metric_points", "otelcol_receiver_failed_log_records":
		return &tenantCounter{Int64Counter: counter}, nil
	default:
		return counter, nil
	}
}

type tenantCounter struct{ metric.Int64Counter }

func (c *tenantCounter) Add(ctx context.Context, value int64, options ...metric.AddOption) {
	auth := client.FromContext(ctx).Auth
	if auth != nil {
		if tenant, ok := auth.GetAttribute("tenant_id").(string); ok && tenant != "" {
			// Append without mutating the caller's reusable option slice. Last wins,
			// so the authenticated identity overrides an existing tenant attribute.
			enriched := make([]metric.AddOption, len(options)+1)
			copy(enriched, options)
			enriched[len(options)] = metric.WithAttributes(attribute.String(TenantKey, tenant))
			options = enriched
		}
	}
	c.Int64Counter.Add(ctx, value, options...)
}
