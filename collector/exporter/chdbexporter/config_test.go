// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/cenkalti/backoff/v7"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/config/configretry"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/confmap/confmaptest"
	"go.opentelemetry.io/collector/exporter/exporterhelper"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metadata"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metrics"
)

func TestLoadConfig(t *testing.T) {
	t.Parallel()

	cm, err := confmaptest.LoadConf(filepath.Join("testdata", "config.yaml"))
	require.NoError(t, err)

	defaultCfg := createDefaultConfig()

	storageID := component.MustNewIDWithName("file_storage", "chdb")

	tests := []struct {
		id       component.ID
		expected component.Config
	}{
		{
			id:       component.NewIDWithName(metadata.Type, ""),
			expected: defaultCfg,
		},
		{
			id: component.NewIDWithName(metadata.Type, "full"),
			expected: &Config{
				schema:          &schemaGuard{},
				TTL:             72 * time.Hour,
				LogsTableName:   "otel_logs",
				TracesTableName: "otel_traces",
				TimeoutSettings: exporterhelper.TimeoutConfig{
					Timeout: 5 * time.Second,
				},
				BackOffConfig: configretry.BackOffConfig{
					Enabled:             true,
					InitialInterval:     5 * time.Second,
					MaxInterval:         30 * time.Second,
					MaxElapsedTime:      300 * time.Second,
					RandomizationFactor: backoff.DefaultRandomizationFactor,
					Multiplier:          backoff.DefaultMultiplier,
				},
				MetricsTables: MetricTablesConfig{
					Gauge:                metrics.MetricTypeConfig{Name: "otel_metrics_custom_gauge"},
					Sum:                  metrics.MetricTypeConfig{Name: "otel_metrics_custom_sum"},
					Summary:              metrics.MetricTypeConfig{Name: "otel_metrics_custom_summary"},
					Histogram:            metrics.MetricTypeConfig{Name: "otel_metrics_custom_histogram"},
					ExponentialHistogram: metrics.MetricTypeConfig{Name: "otel_metrics_custom_exp_histogram"},
				},
				QueueSettings: configoptional.Some(func() exporterhelper.QueueBatchConfig {
					queue := exporterhelper.NewDefaultQueueConfig()
					queue.NumConsumers = 10
					queue.QueueSize = 100
					queue.StorageID = &storageID
					return queue
				}()),
			},
		},
	}

	batchCfg := withDefaultConfig(func(cfg *Config) {
		cfg.QueueSettings = configoptional.Some(func() exporterhelper.QueueBatchConfig {
			queue := exporterhelper.NewDefaultQueueConfig()
			batch := queue.Batch.GetOrInsertDefault()
			batch.FlushTimeout = 5 * time.Second
			batch.Sizer = exporterhelper.RequestSizerTypeItems
			batch.MinSize = 5000
			batch.MaxSize = 10000
			return queue
		}())
	})

	tests = append(tests, struct {
		id       component.ID
		expected component.Config
	}{
		id:       component.NewIDWithName(metadata.Type, "batch"),
		expected: batchCfg,
	})

	for _, tt := range tests {
		t.Run(tt.id.String(), func(t *testing.T) {
			factory := NewFactory()
			cfg := factory.CreateDefaultConfig()

			sub, err := cm.Sub(tt.id.String())
			require.NoError(t, err)
			require.NoError(t, sub.Unmarshal(cfg))

			assert.NoError(t, confmap.Validate(cfg))
			assert.Equal(t, tt.expected, cfg)
		})
	}
}

func withDefaultConfig(fns ...func(*Config)) *Config {
	cfg := createDefaultConfig().(*Config)
	for _, fn := range fns {
		fn(cfg)
	}
	return cfg
}
