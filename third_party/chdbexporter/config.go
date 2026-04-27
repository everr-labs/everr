package clickhouseexporter

import (
	"errors"
	"time"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/config/configretry"
	"go.opentelemetry.io/collector/exporter/exporterhelper"

	"github.com/everr-labs/chdbexporter/internal"
)

type Config struct {
	collectorVersion string

	TimeoutSettings           exporterhelper.TimeoutConfig                   `mapstructure:",squash"`
	configretry.BackOffConfig `mapstructure:"retry_on_failure"`
	QueueSettings             configoptional.Optional[exporterhelper.QueueBatchConfig] `mapstructure:"sending_queue"`

	Path       string     `mapstructure:"path"`
	TTL        time.Duration `mapstructure:"ttl"`
	TableNames TableNames `mapstructure:"table_names"`
}

type TableNames struct {
	Traces                      string `mapstructure:"traces"`
	Logs                        string `mapstructure:"logs"`
	MetricsGauge                string `mapstructure:"metrics_gauge"`
	MetricsSum                  string `mapstructure:"metrics_sum"`
	MetricsHistogram            string `mapstructure:"metrics_histogram"`
	MetricsExponentialHistogram string `mapstructure:"metrics_exponential_histogram"`
	MetricsSummary              string `mapstructure:"metrics_summary"`
}

func createDefaultConfig() component.Config {
	return &Config{
		collectorVersion: "unknown",
		TimeoutSettings:  exporterhelper.NewDefaultTimeoutConfig(),
		QueueSettings:    configoptional.Some(exporterhelper.NewDefaultQueueConfig()),
		BackOffConfig:    configretry.NewDefaultBackOffConfig(),
		TTL:              48 * time.Hour,
	}
}

func (cfg *Config) Validate() error {
	var err error
	if cfg.Path == "" {
		err = errors.Join(err, errors.New("path must be specified"))
	}
	if cfg.TTL <= 0 {
		err = errors.Join(err, errors.New("ttl must be greater than zero"))
	}
	return err
}

func (cfg *Config) database() string {
	return internal.DefaultDatabase
}

func (cfg *Config) tracesTableName() string {
	if cfg.TableNames.Traces != "" {
		return cfg.TableNames.Traces
	}
	return "otel_traces"
}

func (cfg *Config) logsTableName() string {
	if cfg.TableNames.Logs != "" {
		return cfg.TableNames.Logs
	}
	return "otel_logs"
}

func (cfg *Config) metricsGaugeTableName() string {
	if cfg.TableNames.MetricsGauge != "" {
		return cfg.TableNames.MetricsGauge
	}
	return "otel_metrics_gauge"
}

func (cfg *Config) metricsSumTableName() string {
	if cfg.TableNames.MetricsSum != "" {
		return cfg.TableNames.MetricsSum
	}
	return "otel_metrics_sum"
}

func (cfg *Config) metricsHistogramTableName() string {
	if cfg.TableNames.MetricsHistogram != "" {
		return cfg.TableNames.MetricsHistogram
	}
	return "otel_metrics_histogram"
}

func (cfg *Config) metricsExponentialHistogramTableName() string {
	if cfg.TableNames.MetricsExponentialHistogram != "" {
		return cfg.TableNames.MetricsExponentialHistogram
	}
	return "otel_metrics_exponential_histogram"
}

func (cfg *Config) metricsSummaryTableName() string {
	if cfg.TableNames.MetricsSummary != "" {
		return cfg.TableNames.MetricsSummary
	}
	return "otel_metrics_summary"
}
