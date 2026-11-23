// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"
	"strconv"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterhelper"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/landing"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

var componentType = component.MustNewType("chdb")

// LandingTables lists the tables the exporter writes and the columns it
// sends, so the module that builds the store can check them against it.
func LandingTables() []landing.Table {
	return landing.Tables()
}

// NewFactory creates the factory for the local chDB exporter. The handle must
// be a store that already has the otel.* landing tables: the exporter creates
// no table.
func NewFactory(handle *chdb.Handle) exporter.Factory {
	return exporter.NewFactory(
		componentType,
		createDefaultConfig,
		exporter.WithLogs(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Logs, error) {
			c := cfg.(*Config)
			exp := &logsExporter{handle: handle, retentionDays: retentionDays(c)}
			return exporterhelper.NewLogs(ctx, set, cfg, exp.pushLogsData, options(c)...)
		}, component.StabilityLevelBeta),
		exporter.WithTraces(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Traces, error) {
			c := cfg.(*Config)
			exp := &tracesExporter{handle: handle, retentionDays: retentionDays(c)}
			return exporterhelper.NewTraces(ctx, set, cfg, exp.pushTraceData, options(c)...)
		}, component.StabilityLevelBeta),
		exporter.WithMetrics(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Metrics, error) {
			c := cfg.(*Config)
			exp := &metricsExporter{handle: handle, retentionDays: retentionDays(c)}
			return exporterhelper.NewMetrics(ctx, set, cfg, exp.pushMetricsData, options(c)...)
		}, component.StabilityLevelAlpha),
	)
}

func retentionDays(cfg *Config) string {
	return strconv.FormatUint(uint64(cfg.RetentionDays), 10)
}

func options(cfg *Config) []exporterhelper.Option {
	return []exporterhelper.Option{
		// Every push writes the retention stamp into the resource it was given.
		exporterhelper.WithCapabilities(consumer.Capabilities{MutatesData: true}),
		exporterhelper.WithTimeout(cfg.TimeoutSettings),
		exporterhelper.WithQueue(cfg.QueueSettings),
		exporterhelper.WithRetry(cfg.BackOffConfig),
	}
}
