// Package usagequeue connects ingestion to storage through the Collector's persistent queue.
package usagequeue

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/everr-labs/everr/collector/usage"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/config/configretry"
	"go.opentelemetry.io/collector/connector"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/pdata/xpdata/pref"
)

const Type = "everr_queue"

type Config struct {
	Extension component.ID                                             `mapstructure:"extension"`
	Queue     configoptional.Optional[exporterhelper.QueueBatchConfig] `mapstructure:"sending_queue"`
	Retry     configretry.BackOffConfig                                `mapstructure:"retry_on_failure"`
	Timeout   time.Duration                                            `mapstructure:"timeout"`
}

func (c *Config) Validate() error {
	if c.Extension.Type().String() != usage.Type {
		return errors.New("extension must reference an everr_usage extension")
	}
	if !c.Queue.HasValue() || c.Queue.Get().StorageID == nil || c.Queue.Get().WaitForResult {
		return errors.New("everr_queue requires persistent storage and wait_for_result=false")
	}
	if !c.Retry.Enabled || c.Retry.MaxElapsedTime != 0 {
		return errors.New("everr_queue requires retries with max_elapsed_time=0 to retain telemetry during outages")
	}
	if c.Timeout <= 0 {
		return errors.New("timeout must be positive")
	}
	return c.Queue.Get().Validate()
}

func NewFactory() connector.Factory {
	return connector.NewFactory(component.MustNewType(Type), func() component.Config {
		q := exporterhelper.NewDefaultQueueConfig()
		storageID := component.NewIDWithName(component.MustNewType("file_storage"), "ingestion")
		q.StorageID = &storageID
		q.QueueSize = 10000
		batch := q.Batch.GetOrInsertDefault()
		batch.MinSize = 8192
		batch.FlushTimeout = time.Second
		batch.Sizer = exporterhelper.RequestSizerTypeItems
		retry := configretry.NewDefaultBackOffConfig()
		retry.MaxElapsedTime = 0
		return &Config{Extension: component.NewID(component.MustNewType(usage.Type)), Queue: configoptional.Some(q), Retry: retry, Timeout: 5 * time.Second}
	}, connector.WithLogsToLogs(createLogs, component.StabilityLevelDevelopment),
		connector.WithTracesToTraces(createTraces, component.StabilityLevelDevelopment),
		connector.WithMetricsToMetrics(createMetrics, component.StabilityLevelDevelopment))
}

type queue struct {
	cfg       Config
	meter     *usage.Meter
	component component.Component
	logs      consumer.Logs
	traces    consumer.Traces
	metrics   consumer.Metrics
}

func (q *queue) Start(ctx context.Context, host component.Host) error {
	var err error
	q.meter, err = usage.Lookup(host, q.cfg.Extension)
	if err != nil {
		return err
	}
	return q.component.Start(ctx, host)
}
func (q *queue) Shutdown(ctx context.Context) error { return q.component.Shutdown(ctx) }
func (*queue) Capabilities() consumer.Capabilities  { return consumer.Capabilities{MutatesData: true} }
func (q *queue) ConsumeLogs(ctx context.Context, data plog.Logs) error {
	return q.logs.ConsumeLogs(q.meter.MarkEnqueued(ctx), data)
}
func (q *queue) ConsumeTraces(ctx context.Context, data ptrace.Traces) error {
	return q.traces.ConsumeTraces(q.meter.MarkEnqueued(ctx), data)
}
func (q *queue) ConsumeMetrics(ctx context.Context, data pmetric.Metrics) error {
	return q.metrics.ConsumeMetrics(q.meter.MarkEnqueued(ctx), data)
}

func options(cfg Config) []exporterhelper.Option {
	q := *cfg.Queue.Get()
	if q.Batch.HasValue() {
		q.Batch = configoptional.Some(*q.Batch.Get())
	}
	batch := q.Batch.GetOrInsertDefault()
	keys := slices.Clone(batch.Partition.MetadataKeys)
	if !slices.ContainsFunc(keys, func(k string) bool { return strings.EqualFold(k, usage.EpochMetadataKey) }) {
		keys = append(keys, usage.EpochMetadataKey)
	}
	// Never mix replayed and current-run data under the same request context.
	batch.Partition.MetadataKeys = keys
	return []exporterhelper.Option{
		exporterhelper.WithQueue(configoptional.Some(q)), exporterhelper.WithRetry(cfg.Retry),
		exporterhelper.WithTimeout(exporterhelper.TimeoutConfig{Timeout: cfg.Timeout}),
		exporterhelper.WithCapabilities(consumer.Capabilities{MutatesData: true}),
	}
}
func settings(set connector.Settings) exporter.Settings {
	return exporter.Settings{ID: set.ID, TelemetrySettings: set.TelemetrySettings, BuildInfo: set.BuildInfo}
}

func createLogs(ctx context.Context, set connector.Settings, c component.Config, next consumer.Logs) (connector.Logs, error) {
	cfg := *c.(*Config)
	e, err := exporterhelper.NewLogs(ctx, settings(set), c, func(ctx context.Context, data plog.Logs) error {
		// The queue owns its payload across retries. Give each downstream attempt
		// its own pipeline-owned copy so mutation and reference release stay local.
		attempt := plog.NewLogs()
		data.CopyTo(attempt)
		pref.MarkPipelineOwnedLogs(attempt)
		defer pref.UnrefLogs(attempt)
		return next.ConsumeLogs(ctx, attempt)
	}, options(cfg)...)
	if err != nil {
		return nil, err
	}
	return &queue{cfg: cfg, component: e, logs: e}, nil
}
func createTraces(ctx context.Context, set connector.Settings, c component.Config, next consumer.Traces) (connector.Traces, error) {
	cfg := *c.(*Config)
	e, err := exporterhelper.NewTraces(ctx, settings(set), c, func(ctx context.Context, data ptrace.Traces) error {
		// The queue owns its payload across retries. Give each downstream attempt
		// its own pipeline-owned copy so mutation and reference release stay local.
		attempt := ptrace.NewTraces()
		data.CopyTo(attempt)
		pref.MarkPipelineOwnedTraces(attempt)
		defer pref.UnrefTraces(attempt)
		return next.ConsumeTraces(ctx, attempt)
	}, options(cfg)...)
	if err != nil {
		return nil, err
	}
	return &queue{cfg: cfg, component: e, traces: e}, nil
}
func createMetrics(ctx context.Context, set connector.Settings, c component.Config, next consumer.Metrics) (connector.Metrics, error) {
	cfg := *c.(*Config)
	e, err := exporterhelper.NewMetrics(ctx, settings(set), c, func(ctx context.Context, data pmetric.Metrics) error {
		// The queue owns its payload across retries. Give each downstream attempt
		// its own pipeline-owned copy so mutation and reference release stay local.
		attempt := pmetric.NewMetrics()
		data.CopyTo(attempt)
		pref.MarkPipelineOwnedMetrics(attempt)
		defer pref.UnrefMetrics(attempt)
		return next.ConsumeMetrics(ctx, attempt)
	}, options(cfg)...)
	if err != nil {
		return nil, err
	}
	return &queue{cfg: cfg, component: e, metrics: e}, nil
}
