package everrusageextension

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/extension/extensioncapabilities"
)

var _ extensioncapabilities.ConfigSnapshotWatcher = (*Meter)(nil)

func (*Meter) NotifyConfigSnapshot(_ context.Context, snapshot extensioncapabilities.ConfigSnapshot) error {
	return validateTopology(snapshot.Effective())
}

type pipelineConfig struct {
	Receivers  []string `mapstructure:"receivers"`
	Processors []string `mapstructure:"processors"`
	Exporters  []string `mapstructure:"exporters"`
}

func validateTopology(conf *confmap.Conf) error {
	var cfg struct {
		Service struct {
			Pipelines  map[string]pipelineConfig `mapstructure:"pipelines"`
			Extensions []string                  `mapstructure:"extensions"`
		} `mapstructure:"service"`
		Extensions map[string]struct {
			FSync bool `mapstructure:"fsync"`
		} `mapstructure:"extensions"`
		Exporters map[string]struct {
			SendingQueue configoptional.Optional[exporterhelper.QueueBatchConfig] `mapstructure:"sending_queue"`
			Retry        struct {
				Enabled        *bool         `mapstructure:"enabled"`
				MaxElapsedTime time.Duration `mapstructure:"max_elapsed_time"`
			} `mapstructure:"retry_on_failure"`
		} `mapstructure:"exporters"`
	}
	if err := conf.Unmarshal(&cfg, confmap.WithIgnoreUnused()); err != nil {
		return err
	}
	for name, p := range cfg.Service.Pipelines {
		meters, publishers := 0, 0
		for _, id := range p.Processors {
			if componentType(id) == Type {
				meters++
			}
		}
		for _, id := range p.Receivers {
			if componentType(id) == Type {
				publishers++
			}
		}
		if meters == 0 && publishers == 0 {
			continue
		}
		if publishers > 0 {
			if componentType(name) != "metrics" || meters != 0 {
				return fmt.Errorf("pipeline %s: usage publication must be metrics and bypass metering", name)
			}
			continue
		}
		if len(p.Exporters) != 1 {
			return fmt.Errorf("pipeline %s: admission metering requires one exporter", name)
		}
		e, ok := cfg.Exporters[p.Exporters[0]]
		if !ok {
			return fmt.Errorf("pipeline %s: usage must feed an exporter directly", name)
		}
		q := e.SendingQueue.Get()
		if meters != 1 || componentType(p.Processors[len(p.Processors)-1]) != Type {
			return fmt.Errorf("pipeline %s: one usage processor must directly precede the exporter", name)
		}
		if !e.SendingQueue.HasValue() || q.WaitForResult || q.StorageID == nil || q.StorageID.Type().String() != "file_storage" {
			return fmt.Errorf("pipeline %s: admission metering requires a persistent exporter queue and wait_for_result=false", name)
		}
		storage, ok := cfg.Extensions[q.StorageID.String()]
		if !ok || !storage.FSync || !slices.Contains(cfg.Service.Extensions, q.StorageID.String()) {
			return fmt.Errorf("pipeline %s: queue file storage must be enabled with fsync=true", name)
		}
		if e.Retry.Enabled == nil || !*e.Retry.Enabled || e.Retry.MaxElapsedTime != 0 {
			return fmt.Errorf("pipeline %s: ingestion exporter requires unlimited retries", name)
		}
	}
	return nil
}

func componentType(id string) string { kind, _, _ := strings.Cut(id, "/"); return kind }
