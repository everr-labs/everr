// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"errors"
	"strings"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/config/configretry"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/pdata/pcommon"
)

const retentionAttribute = "everr.retention.days"

// stampRetention sets the resource's everr.retention.days to the configured
// days. A JSON column keeps the first of two values for one path, and a
// client's nested spelling of the path sorts before the flat key, so every
// spelling is removed before the stamp is written.
func stampRetention(resource pcommon.Map, days string) {
	removePath(resource, retentionAttribute)
	resource.PutStr(retentionAttribute, days)
}

func removePath(attrs pcommon.Map, path string) {
	attrs.RemoveIf(func(key string, value pcommon.Value) bool {
		if key == path {
			return true
		}
		if rest, ok := strings.CutPrefix(path, key+"."); ok && value.Type() == pcommon.ValueTypeMap {
			removePath(value.Map(), rest)
		}
		return false
	})
}

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
