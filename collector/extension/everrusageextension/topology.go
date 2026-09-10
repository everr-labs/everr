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

type publisherConfig struct {
	Extension string `mapstructure:"extension"`
}

func (c publisherConfig) extensionID() string {
	if c.Extension == "" {
		return Type
	}
	return c.Extension
}

type pipelineConfig struct {
	Receivers  []string `mapstructure:"receivers"`
	Processors []string `mapstructure:"processors"`
	Exporters  []string `mapstructure:"exporters"`
}

func validateTopology(conf *confmap.Conf) error {
	var cfg struct {
		Connectors map[string]publisherConfig `mapstructure:"connectors"`
		Processors map[string]publisherConfig `mapstructure:"processors"`
		Service    struct {
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
	// An enabled connector must cover every admission pipeline using its meter.
	// Otherwise the final flush could still precede an unconnected admission.
	connectorByExtension := map[string]string{}
	for name, p := range cfg.Service.Pipelines {
		for _, id := range p.Receivers {
			if componentType(id) != Type+"_connector" {
				continue
			}
			c, ok := cfg.Connectors[id]
			if !ok {
				return fmt.Errorf("pipeline %s: missing usage connector %s", name, id)
			}
			ext := c.extensionID()
			if _, ok := connectorByExtension[ext]; ok {
				return fmt.Errorf("extension %s: require one usage connector and one publication pipeline", ext)
			}
			connectorByExtension[ext] = id
		}
	}
	for name, p := range cfg.Service.Pipelines {
		meters, publishers := 0, 0
		for _, id := range p.Processors {
			if componentType(id) == Type {
				meters++
			}
		}
		for _, id := range p.Receivers {
			if componentType(id) == Type+"_connector" {
				publishers++
			}
		}
		storageExporters := []string{}
		anchors := []string{}
		for _, id := range p.Exporters {
			if componentType(id) == Type+"_connector" {
				anchors = append(anchors, id)
			} else {
				storageExporters = append(storageExporters, id)
			}
		}
		if len(anchors) > 0 && (meters != 1 || publishers != 0) {
			return fmt.Errorf("pipeline %s: usage connector input requires one usage processor and must bypass publication", name)
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
		if len(storageExporters) != 1 || len(anchors) > 1 {
			return fmt.Errorf("pipeline %s: admission metering requires one exporter", name)
		}
		e, ok := cfg.Exporters[storageExporters[0]]
		if !ok {
			return fmt.Errorf("pipeline %s: usage must feed an exporter directly", name)
		}
		for _, id := range p.Processors {
			if componentType(id) != Type {
				continue
			}
			expected := connectorByExtension[cfg.Processors[id].extensionID()]
			if expected == "" || !slices.Equal(anchors, []string{expected}) {
				return fmt.Errorf("pipeline %s: must attach the usage connector publishing its extension", name)
			}
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
