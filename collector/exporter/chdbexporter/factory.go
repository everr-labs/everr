// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

//go:generate ../../.tools/mdatagen metadata.yaml

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/featuregate"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metadata"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

// Deprecated: Use the `json` config option instead. This feature gate will be removed in a future version.
var featureGateJSON = featuregate.GlobalRegistry().MustRegister(
	"clickhouse.json",
	featuregate.StageDeprecated,
	featuregate.WithRegisterDescription("Deprecated: Use the `json` config option instead."),
	featuregate.WithRegisterToVersion("v0.149.0"),
)

// NewFactory creates a factory for the ClickHouse exporter.
func NewFactory() exporter.Factory {
	return NewFactoryWithHandle(nil)
}

// NewFactoryWithHandle creates a factory for the local chDB exporter.
func NewFactoryWithHandle(handle *chdb.Handle) exporter.Factory {
	return exporter.NewFactory(
		metadata.Type,
		createDefaultConfig,
		exporter.WithLogs(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Logs, error) {
			return createLogsExporter(ctx, set, cfg, handle)
		}, metadata.LogsStability),
		exporter.WithTraces(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Traces, error) {
			return createTracesExporter(ctx, set, cfg, handle)
		}, metadata.TracesStability),
		exporter.WithMetrics(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Metrics, error) {
			return createMetricExporter(ctx, set, cfg, handle)
		}, metadata.MetricsStability),
	)
}

func createLogsExporter(
	ctx context.Context,
	set exporter.Settings,
	cfg component.Config,
	handle *chdb.Handle,
) (exporter.Logs, error) {
	c := cfg.(*Config)
	c.collectorVersion = set.BuildInfo.Version

	var exp anyLogsExporter
	if useJSON(set.Logger, c) {
		exp = newLogsJSONExporter(set.Logger, c, handle)
	} else {
		exp = newLogsExporter(set.Logger, c, handle)
	}

	return exporterhelper.NewLogs(
		ctx,
		set,
		cfg,
		exp.pushLogsData,
		exporterhelper.WithStart(exp.start),
		exporterhelper.WithShutdown(exp.shutdown),
		exporterhelper.WithTimeout(c.TimeoutSettings),
		exporterhelper.WithQueue(c.QueueSettings),
		exporterhelper.WithRetry(c.BackOffConfig),
	)
}

func createTracesExporter(
	ctx context.Context,
	set exporter.Settings,
	cfg component.Config,
	handle *chdb.Handle,
) (exporter.Traces, error) {
	c := cfg.(*Config)
	c.collectorVersion = set.BuildInfo.Version

	var exp anyTracesExporter
	if useJSON(set.Logger, c) {
		exp = newTracesJSONExporter(set.Logger, c, handle)
	} else {
		exp = newTracesExporter(set.Logger, c, handle)
	}

	return exporterhelper.NewTraces(
		ctx,
		set,
		cfg,
		exp.pushTraceData,
		exporterhelper.WithStart(exp.start),
		exporterhelper.WithShutdown(exp.shutdown),
		exporterhelper.WithTimeout(c.TimeoutSettings),
		exporterhelper.WithQueue(c.QueueSettings),
		exporterhelper.WithRetry(c.BackOffConfig),
	)
}

func useJSON(logger *zap.Logger, c *Config) bool {
	if featureGateJSON.IsEnabled() {
		logger.Warn("The clickhouse.json feature gate is deprecated. Use the `json` config option instead.")
		return true
	}
	return c.JSON
}

func createMetricExporter(
	ctx context.Context,
	set exporter.Settings,
	cfg component.Config,
	handle *chdb.Handle,
) (exporter.Metrics, error) {
	c := cfg.(*Config)
	c.collectorVersion = set.BuildInfo.Version
	exp := newMetricsExporter(set.Logger, c, handle)

	return exporterhelper.NewMetrics(
		ctx,
		set,
		cfg,
		exp.pushMetricsData,
		exporterhelper.WithStart(exp.start),
		exporterhelper.WithShutdown(exp.shutdown),
		exporterhelper.WithTimeout(c.TimeoutSettings),
		exporterhelper.WithQueue(c.QueueSettings),
		exporterhelper.WithRetry(c.BackOffConfig),
	)
}
