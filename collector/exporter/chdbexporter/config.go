// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"time"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/config/configretry"
	"go.opentelemetry.io/collector/exporter/exporterhelper"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metrics"
)

// Config defines configuration for the chDB exporter.
type Config struct {
	// schema serialises the local schema-version check across the exporters
	// that share this config, which is every signal of one exporter component.
	// See ensureLocalSchema.
	schema *schemaGuard

	TimeoutSettings exporterhelper.TimeoutConfig                             `mapstructure:",squash"`
	BackOffConfig   configretry.BackOffConfig                                `mapstructure:"retry_on_failure"`
	QueueSettings   configoptional.Optional[exporterhelper.QueueBatchConfig] `mapstructure:"sending_queue"`

	// LogsTableName is the table name for logs. default is `otel_logs`.
	LogsTableName string `mapstructure:"logs_table_name"`
	// TracesTableName is the table name for traces. default is `otel_traces`.
	TracesTableName string `mapstructure:"traces_table_name"`
	// TTL is The data time-to-live example 30m, 48h. 0 means no ttl.
	TTL time.Duration `mapstructure:"ttl"`
	// MetricsTables defines the table names for metric types.
	MetricsTables MetricTablesConfig `mapstructure:"metrics_tables"`
}

type MetricTablesConfig struct {
	// Gauge is the table name for gauge metric type. default is `otel_metrics_gauge`.
	Gauge metrics.MetricTypeConfig `mapstructure:"gauge"`
	// Sum is the table name for sum metric type. default is `otel_metrics_sum`.
	Sum metrics.MetricTypeConfig `mapstructure:"sum"`
	// Summary is the table name for summary metric type. default is `otel_metrics_summary`.
	Summary metrics.MetricTypeConfig `mapstructure:"summary"`
	// Histogram is the table name for histogram metric type. default is `otel_metrics_histogram`.
	Histogram metrics.MetricTypeConfig `mapstructure:"histogram"`
	// ExponentialHistogram is the table name for exponential histogram metric type. default is `otel_metrics_exponential_histogram`.
	ExponentialHistogram metrics.MetricTypeConfig `mapstructure:"exponential_histogram"`
}

const (
	defaultMetricTableName    = "otel_metrics"
	defaultGaugeSuffix        = "_gauge"
	defaultSumSuffix          = "_sum"
	defaultSummarySuffix      = "_summary"
	defaultHistogramSuffix    = "_histogram"
	defaultExpHistogramSuffix = "_exponential_histogram"
)

func createDefaultConfig() component.Config {
	return &Config{
		schema: &schemaGuard{},

		TimeoutSettings: exporterhelper.NewDefaultTimeoutConfig(),
		QueueSettings:   configoptional.Some(exporterhelper.NewDefaultQueueConfig()),
		BackOffConfig:   configretry.NewDefaultBackOffConfig(),
		LogsTableName:   "otel_logs",
		TracesTableName: "otel_traces",
		TTL:             7 * 24 * time.Hour,
		MetricsTables: MetricTablesConfig{
			Gauge:                metrics.MetricTypeConfig{Name: defaultMetricTableName + defaultGaugeSuffix},
			Sum:                  metrics.MetricTypeConfig{Name: defaultMetricTableName + defaultSumSuffix},
			Summary:              metrics.MetricTypeConfig{Name: defaultMetricTableName + defaultSummarySuffix},
			Histogram:            metrics.MetricTypeConfig{Name: defaultMetricTableName + defaultHistogramSuffix},
			ExponentialHistogram: metrics.MetricTypeConfig{Name: defaultMetricTableName + defaultExpHistogramSuffix},
		},
	}
}
