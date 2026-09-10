// Package everrusageextension accounts for durably accepted ingestion and publishes tenant-scoped metrics.
package everrusageextension

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pipeline"
	"go.uber.org/zap"
)

const (
	Type         = "everr_usage"
	MetricName   = "everr.ingestion.volume"
	TenantKey    = "everr.tenant.id"
	RetentionKey = "everr.retention.days"
	MonthKey     = "everr.usage.month"
	// Integer values above this limit cannot be represented exactly in metrics_sum.Value.
	maxBytes = int64(1 << 53)
)

type Config struct {
	MaxSeries int `mapstructure:"max_series"`
}

func (c *Config) Validate() error {
	if c.MaxSeries <= 0 {
		return errors.New("max_series must be positive")
	}
	return nil
}

func NewFactory() extension.Factory {
	return extension.NewFactory(component.MustNewType(Type), func() component.Config {
		return &Config{MaxSeries: 30000}
	}, func(_ context.Context, set extension.Settings, cfg component.Config) (extension.Extension, error) {
		return newMeter(*cfg.(*Config), set.Logger), nil
	}, component.StabilityLevelDevelopment)
}

type key struct {
	tenant, month string
	signal        pipeline.Signal
}
type total struct {
	bytes int64
	start time.Time
}

type Meter struct {
	component.StartFunc
	component.ShutdownFunc
	cfg       Config
	logger    *zap.Logger
	instance  string
	mu        sync.Mutex
	totals    map[key]total
	dropped   uint64
	publisher bool
}

func newMeter(cfg Config, logger *zap.Logger) *Meter {
	return &Meter{cfg: cfg, logger: logger, instance: uuid.NewString(), totals: make(map[key]total)}
}

func Lookup(host component.Host, id component.ID) (*Meter, error) {
	meter, ok := host.GetExtensions()[id].(*Meter)
	if !ok {
		return nil, fmt.Errorf("usage extension %s is not enabled", id)
	}
	return meter, nil
}

// ClaimPublisher prevents two publishers from splitting intervals for the same stream.
func (m *Meter) ClaimPublisher() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.publisher {
		return errors.New("a usage extension must have exactly one usage publisher")
	}
	m.publisher = true
	return nil
}

// Record retains only scalar measurements, never customer payloads. Overflow loses usage.
func (m *Meter) Record(signal pipeline.Signal, bytesByTenant map[string]int64) {
	m.recordAt(signal, bytesByTenant, time.Now())
}

func (m *Meter) recordAt(signal pipeline.Signal, bytesByTenant map[string]int64, now time.Time) {
	switch signal {
	case pipeline.SignalLogs, pipeline.SignalTraces, pipeline.SignalMetrics:
	default:
		m.logger.Error("Unsupported usage signal", zap.String("signal", signal.String()))
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	month := now.UTC().Format("2006-01")
	for tenant, bytes := range bytesByTenant {
		if bytes <= 0 {
			continue
		}
		k := key{tenant: tenant, signal: signal, month: month}
		v, exists := m.totals[k]
		if (!exists && len(m.totals) >= m.cfg.MaxSeries) || bytes > maxBytes-v.bytes {
			m.dropped++
			continue
		}
		if !exists {
			v.start = now
		}
		v.bytes += bytes
		m.totals[k] = v
	}
}

// Drain consumes a snapshot permanently before publication is attempted.
// Convert these deltas to cumulative before the retrying exporter, never replay them here.
func (m *Meter) Drain() pmetric.Metrics {
	return m.drainAt(time.Now())
}

func (m *Meter) drainAt(end time.Time) pmetric.Metrics {
	m.mu.Lock()
	totals, dropped := m.totals, m.dropped
	m.totals = make(map[key]total)
	m.dropped = 0
	m.mu.Unlock()
	if dropped > 0 {
		m.logger.Warn("Usage measurements dropped at accumulator limit", zap.Uint64("measurements", dropped))
	}
	customer := pmetric.NewMetrics()
	for k, v := range totals {
		m.appendPoint(customer, k, v, end)
	}
	return customer
}

func (m *Meter) appendPoint(md pmetric.Metrics, k key, v total, end time.Time) {
	rm := md.ResourceMetrics().AppendEmpty()
	attrs := rm.Resource().Attributes()
	attrs.PutStr(TenantKey, k.tenant)
	attrs.PutStr(RetentionKey, "365")
	attrs.PutStr("service.name", "everr-ingestion")
	attrs.PutStr("service.instance.id", m.instance)
	sm := rm.ScopeMetrics().AppendEmpty()
	sm.Scope().SetName("github.com/everr-labs/everr/collector/usage")
	sm.Scope().SetVersion("1")
	metric := sm.Metrics().AppendEmpty()
	metric.SetName(MetricName)
	metric.SetUnit("By")
	metric.SetDescription("Decoded OTLP protobuf bytes durably accepted for ingestion, measurement version 1")
	sum := metric.SetEmptySum()
	sum.SetIsMonotonic(true)
	sum.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
	point := sum.DataPoints().AppendEmpty()
	point.SetIntValue(v.bytes)
	point.SetStartTimestamp(pcommon.NewTimestampFromTime(v.start))
	point.SetTimestamp(pcommon.NewTimestampFromTime(end))
	point.Attributes().PutStr(MonthKey, k.month)
	point.Attributes().PutStr("everr.ingestion.signal", k.signal.String())
	point.Attributes().PutStr("everr.usage.tenant.id", k.tenant)
}
