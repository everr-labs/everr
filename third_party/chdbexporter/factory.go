package clickhouseexporter

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterhelper"

	"github.com/everr-labs/chdbexporter/internal/metadata"
)

func NewFactory() exporter.Factory {
	return exporter.NewFactory(
		metadata.Type,
		createDefaultConfig,
		exporter.WithLogs(createLogsExporter, metadata.LogsStability),
		exporter.WithTraces(createTracesExporter, metadata.TracesStability),
		exporter.WithMetrics(createMetricsExporter, metadata.MetricsStability),
	)
}

func createLogsExporter(
	ctx context.Context,
	set exporter.Settings,
	cfg component.Config,
) (exporter.Logs, error) {
	config := cfg.(*Config)
	config.collectorVersion = set.BuildInfo.Version
	exp := newLogsExporter(set.Logger, config)

	return exporterhelper.NewLogs(
		ctx,
		set,
		cfg,
		exp.pushLogsData,
		exporterhelper.WithStart(exp.start),
		exporterhelper.WithShutdown(exp.shutdown),
		exporterhelper.WithTimeout(config.TimeoutSettings),
		exporterhelper.WithQueue(config.QueueSettings),
		exporterhelper.WithRetry(config.BackOffConfig),
	)
}

func createTracesExporter(
	ctx context.Context,
	set exporter.Settings,
	cfg component.Config,
) (exporter.Traces, error) {
	config := cfg.(*Config)
	config.collectorVersion = set.BuildInfo.Version
	exp := newTracesExporter(set.Logger, config)

	return exporterhelper.NewTraces(
		ctx,
		set,
		cfg,
		exp.pushTraceData,
		exporterhelper.WithStart(exp.start),
		exporterhelper.WithShutdown(exp.shutdown),
		exporterhelper.WithTimeout(config.TimeoutSettings),
		exporterhelper.WithQueue(config.QueueSettings),
		exporterhelper.WithRetry(config.BackOffConfig),
	)
}

func createMetricsExporter(
	ctx context.Context,
	set exporter.Settings,
	cfg component.Config,
) (exporter.Metrics, error) {
	config := cfg.(*Config)
	config.collectorVersion = set.BuildInfo.Version
	exp := newMetricsExporter(set.Logger, config)

	return exporterhelper.NewMetrics(
		ctx,
		set,
		cfg,
		exp.pushMetricsData,
		exporterhelper.WithStart(exp.start),
		exporterhelper.WithShutdown(exp.shutdown),
		exporterhelper.WithTimeout(config.TimeoutSettings),
		exporterhelper.WithQueue(config.QueueSettings),
		exporterhelper.WithRetry(config.BackOffConfig),
	)
}
