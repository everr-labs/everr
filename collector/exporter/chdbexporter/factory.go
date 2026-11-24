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
	"go.opentelemetry.io/collector/exporter/exporterhelper/xexporterhelper"
	"go.opentelemetry.io/collector/exporter/xexporter"

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
	return xexporter.NewFactory(
		componentType,
		createDefaultConfig,
		xexporter.WithLogs(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Logs, error) {
			c := cfg.(*Config)
			table := landing.Logs
			if c.Recordings {
				table = landing.Recordings
			}
			exp := &logsExporter{handle: handle, retentionDays: retentionDays(c), table: table}
			return exporterhelper.NewLogs(ctx, set, cfg, exp.pushLogsData, options(c)...)
		}, component.StabilityLevelBeta),
		xexporter.WithTraces(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Traces, error) {
			c := cfg.(*Config)
			exp := &tracesExporter{handle: handle, retentionDays: retentionDays(c)}
			return exporterhelper.NewTraces(ctx, set, cfg, exp.pushTraceData, options(c)...)
		}, component.StabilityLevelBeta),
		xexporter.WithMetrics(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Metrics, error) {
			c := cfg.(*Config)
			exp := &metricsExporter{handle: handle, retentionDays: retentionDays(c)}
			return exporterhelper.NewMetrics(ctx, set, cfg, exp.pushMetricsData, options(c)...)
		}, component.StabilityLevelAlpha),
		xexporter.WithProfiles(func(ctx context.Context, set exporter.Settings, cfg component.Config) (xexporter.Profiles, error) {
			c := cfg.(*Config)
			exp := &profilesExporter{handle: handle, retentionDays: retentionDays(c)}
			return xexporterhelper.NewProfiles(ctx, set, cfg, exp.pushProfilesData, options(c)...)
		}, component.StabilityLevelDevelopment),
	)
}

func retentionDays(cfg *Config) string {
	return strconv.FormatUint(uint64(cfg.RetentionDays), 10)
}

func options(cfg *Config) []exporterhelper.Option {
	return []exporterhelper.Option{
		exporterhelper.WithCapabilities(consumer.Capabilities{MutatesData: true}),
		exporterhelper.WithTimeout(cfg.TimeoutSettings),
		exporterhelper.WithQueue(cfg.QueueSettings),
		exporterhelper.WithRetry(cfg.BackOffConfig),
	}
}
