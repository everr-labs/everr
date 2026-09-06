// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

//go:generate ../../.tools/mdatagen metadata.yaml

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/exporter/exporterhelper/xexporterhelper"
	"go.opentelemetry.io/collector/exporter/xexporter"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metadata"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

// NewFactory creates a factory for the ClickHouse exporter.
func NewFactory() exporter.Factory {
	return NewFactoryWithHandle(nil)
}

// NewFactoryWithHandle creates a factory for the local chDB exporter.
func NewFactoryWithHandle(handle *chdb.Handle) exporter.Factory {
	return xexporter.NewFactory(
		metadata.Type,
		createDefaultConfig,
		xexporter.WithLogs(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Logs, error) {
			return createLogsExporter(ctx, set, cfg, handle)
		}, metadata.LogsStability),
		xexporter.WithTraces(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Traces, error) {
			return createTracesExporter(ctx, set, cfg, handle)
		}, metadata.TracesStability),
		xexporter.WithMetrics(func(ctx context.Context, set exporter.Settings, cfg component.Config) (exporter.Metrics, error) {
			return createMetricExporter(ctx, set, cfg, handle)
		}, metadata.MetricsStability),
		xexporter.WithProfiles(func(ctx context.Context, set exporter.Settings, cfg component.Config) (xexporter.Profiles, error) {
			return createProfilesExporter(ctx, set, cfg, handle)
		}, metadata.ProfilesStability),
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
	if c.JSON {
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
	if c.JSON {
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

func createProfilesExporter(
	ctx context.Context,
	set exporter.Settings,
	cfg component.Config,
	handle *chdb.Handle,
) (xexporter.Profiles, error) {
	c := cfg.(*Config)
	c.collectorVersion = set.BuildInfo.Version

	exp := newProfilesExporter(set.Logger, c, handle)

	return xexporterhelper.NewProfiles(
		ctx,
		set,
		cfg,
		exp.pushProfilesData,
		exporterhelper.WithStart(exp.start),
		exporterhelper.WithShutdown(exp.shutdown),
		exporterhelper.WithTimeout(c.TimeoutSettings),
		exporterhelper.WithQueue(c.QueueSettings),
		exporterhelper.WithRetry(c.BackOffConfig),
	)
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
