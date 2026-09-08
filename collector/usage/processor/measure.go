package usageprocessor

import (
	"context"
	"errors"
	"strings"

	"github.com/everr-labs/everr/collector/usage"
	"go.opentelemetry.io/collector/consumer/consumererror"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func tenant(res pcommon.Resource) (string, error) {
	v, ok := res.Attributes().Get(usage.TenantKey)
	if !ok || v.Type() != pcommon.ValueTypeStr || v.Str() == "" {
		return "", consumererror.NewPermanent(errors.New("usage requires a trusted nonempty everr.tenant.id on every resource"))
	}
	return v.Str(), nil
}
func stripRouting(res pcommon.Resource) {
	res.Attributes().Remove(usage.TenantKey)
	res.Attributes().Remove(usage.RetentionKey)
}

func (p *metering) ConsumeLogs(ctx context.Context, ld plog.Logs) error {
	groups := map[string]plog.Logs{}
	for _, rm := range ld.ResourceLogs().All() {
		n := 0
		for _, sm := range rm.ScopeLogs().All() {
			n += sm.LogRecords().Len()
		}
		if n == 0 {
			continue
		}
		id, err := tenant(rm.Resource())
		if err != nil {
			return err
		}
		md, ok := groups[id]
		if !ok {
			md = plog.NewLogs()
			groups[id] = md
		}
		copy := md.ResourceLogs().AppendEmpty()
		rm.CopyTo(copy)
		stripRouting(copy.Resource())
		copy.ScopeLogs().RemoveIf(func(sm plog.ScopeLogs) bool { return sm.LogRecords().Len() == 0 })
	}
	sizes := map[string]int64{}
	marshaler := plog.ProtoMarshaler{}
	for id, md := range groups {
		sizes[id] = int64(marshaler.LogsSize(md))
	}
	if err := p.logs.ConsumeLogs(ctx, ld); err != nil {
		return err
	}
	p.meter.RecordConfirmed(ctx, "logs", sizes)
	return nil
}

func (p *metering) ConsumeTraces(ctx context.Context, td ptrace.Traces) error {
	groups := map[string]ptrace.Traces{}
	for _, rm := range td.ResourceSpans().All() {
		n := 0
		for _, sm := range rm.ScopeSpans().All() {
			n += sm.Spans().Len()
		}
		if n == 0 {
			continue
		}
		id, err := tenant(rm.Resource())
		if err != nil {
			return err
		}
		md, ok := groups[id]
		if !ok {
			md = ptrace.NewTraces()
			groups[id] = md
		}
		copy := md.ResourceSpans().AppendEmpty()
		rm.CopyTo(copy)
		stripRouting(copy.Resource())
		copy.ScopeSpans().RemoveIf(func(sm ptrace.ScopeSpans) bool { return sm.Spans().Len() == 0 })
	}
	sizes := map[string]int64{}
	marshaler := ptrace.ProtoMarshaler{}
	for id, md := range groups {
		sizes[id] = int64(marshaler.TracesSize(md))
	}
	if err := p.traces.ConsumeTraces(ctx, td); err != nil {
		return err
	}
	p.meter.RecordConfirmed(ctx, "traces", sizes)
	return nil
}

func (p *metering) ConsumeMetrics(ctx context.Context, md pmetric.Metrics) error {
	// Only the usage receiver can publish the reserved namespace. A client cannot
	// exempt its payload from billing or forge billing points by naming them usage.
	for _, rm := range md.ResourceMetrics().All() {
		for _, sm := range rm.ScopeMetrics().All() {
			sm.Metrics().RemoveIf(func(m pmetric.Metric) bool { return strings.HasPrefix(m.Name(), "everr.ingestion.") })
		}
	}
	groups := map[string]pmetric.Metrics{}
	for _, rm := range md.ResourceMetrics().All() {
		copyData := pmetric.NewMetrics()
		copy := copyData.ResourceMetrics().AppendEmpty()
		rm.CopyTo(copy)
		for _, sm := range copy.ScopeMetrics().All() {
			sm.Metrics().RemoveIf(func(m pmetric.Metric) bool { return points(m) == 0 })
		}
		copy.ScopeMetrics().RemoveIf(func(sm pmetric.ScopeMetrics) bool { return sm.Metrics().Len() == 0 })
		if copy.ScopeMetrics().Len() == 0 {
			continue
		}
		id, err := tenant(copy.Resource())
		if err != nil {
			return err
		}
		stripRouting(copy.Resource())
		grouped, ok := groups[id]
		if !ok {
			grouped = pmetric.NewMetrics()
			groups[id] = grouped
		}
		copy.MoveTo(grouped.ResourceMetrics().AppendEmpty())
	}
	sizes := map[string]int64{}
	marshaler := pmetric.ProtoMarshaler{}
	for id, data := range groups {
		sizes[id] = int64(marshaler.MetricsSize(data))
	}
	if err := p.metrics.ConsumeMetrics(ctx, md); err != nil {
		return err
	}
	p.meter.RecordConfirmed(ctx, "metrics", sizes)
	return nil
}

func points(m pmetric.Metric) int {
	switch m.Type() {
	case pmetric.MetricTypeGauge:
		return m.Gauge().DataPoints().Len()
	case pmetric.MetricTypeSum:
		return m.Sum().DataPoints().Len()
	case pmetric.MetricTypeHistogram:
		return m.Histogram().DataPoints().Len()
	case pmetric.MetricTypeExponentialHistogram:
		return m.ExponentialHistogram().DataPoints().Len()
	case pmetric.MetricTypeSummary:
		return m.Summary().DataPoints().Len()
	default:
		return 0
	}
}
