// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"errors"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/config/configretry"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
)

// retentionAttribute is the resource attribute the store's views read to set
// retention_days. They reject a row where it is missing or zero.
const retentionAttribute = "everr.retention.days"

type Config struct {
	TimeoutSettings exporterhelper.TimeoutConfig                             `mapstructure:",squash"`
	BackOffConfig   configretry.BackOffConfig                                `mapstructure:"retry_on_failure"`
	QueueSettings   configoptional.Optional[exporterhelper.QueueBatchConfig] `mapstructure:"sending_queue"`

	// RetentionDays is how long the store keeps a row. The exporter writes it
	// on every resource as everr.retention.days and replaces a value the
	// client sent.
	RetentionDays uint16 `mapstructure:"retention_days"`
}

func (c *Config) Validate() error {
	if c.RetentionDays == 0 {
		return errors.New("retention_days must be greater than zero")
	}
	return nil
}

func createDefaultConfig() component.Config {
	return &Config{
		TimeoutSettings: exporterhelper.NewDefaultTimeoutConfig(),
		QueueSettings:   configoptional.Some(exporterhelper.NewDefaultQueueConfig()),
		BackOffConfig:   configretry.NewDefaultBackOffConfig(),
	}
}
