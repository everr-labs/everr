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

type topologyConfig struct {
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

func validateTopology(conf *confmap.Conf) error {
	var cfg topologyConfig
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
		_, ok := cfg.Exporters[storageExporters[0]]
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
		if meters != 1 || componentType(p.Processors[len(p.Processors)-1]) != Type {
			return fmt.Errorf("pipeline %s: one usage processor must directly precede the exporter", name)
		}
		if err := cfg.validateQueue(storageExporters[0]); err != nil {
			return fmt.Errorf("pipeline %s: %w", name, err)
		}
	}
	return cfg.validatePublication()
}

func componentType(id string) string { kind, _, _ := strings.Cut(id, "/"); return kind }

// Walk configured connector edges without restricting unrelated custom pipelines.
// Conversion happens once, before fanout; downstream resource rewriting is allowed.
func (cfg topologyConfig) validatePublication() error {
	reached := map[string]bool{}
	usageExporters := map[string]bool{}
	visiting := map[string]bool{}
	var visit func(string, bool) error
	visit = func(name string, root bool) error {
		p := cfg.Service.Pipelines[name]
		// Check the incoming role before the name-only cache. A publication
		// root must not consume another pipeline's already-cumulative output.
		if !root {
			for _, id := range p.Receivers {
				if componentType(id) == Type+"_connector" {
					return fmt.Errorf("pipeline %s: usage publication root cannot also be downstream", name)
				}
			}
		}
		if visiting[name] {
			return fmt.Errorf("pipeline %s: usage publication cycle", name)
		}
		if reached[name] {
			return nil
		}
		visiting[name] = true
		defer delete(visiting, name)
		if componentType(name) != "metrics" {
			return fmt.Errorf("pipeline %s: usage publication must remain metrics", name)
		}
		for _, id := range p.Receivers {
			if _, ok := cfg.Connectors[id]; !ok {
				return fmt.Errorf("pipeline %s: usage publication cannot receive customer telemetry", name)
			}
		}
		conversions := 0
		for _, id := range p.Processors {
			switch componentType(id) {
			case Type:
				return fmt.Errorf("pipeline %s: usage publication must bypass metering", name)
			case "delta_to_cumulative":
				conversions++
			}
		}
		if (root && conversions != 1) || (!root && conversions != 0) {
			return fmt.Errorf("pipeline %s: convert usage to cumulative exactly once before connector fanout", name)
		}
		if len(p.Exporters) == 0 {
			return fmt.Errorf("pipeline %s: usage publication has no destination", name)
		}
		for _, id := range p.Exporters {
			if e, ok := cfg.Exporters[id]; ok {
				q := e.SendingQueue.Get()
				if err := cfg.validateQueue(id); err != nil {
					return err
				}
				if !q.BlockOnOverflow {
					return fmt.Errorf("exporter %s: usage requires block_on_overflow=true", id)
				}
				usageExporters[id] = true
				continue
			}
			if _, ok := cfg.Connectors[id]; !ok {
				return fmt.Errorf("pipeline %s: unknown usage destination %s", name, id)
			}
			destinations := 0
			for target, next := range cfg.Service.Pipelines {
				if slices.Contains(next.Receivers, id) {
					destinations++
					if err := visit(target, false); err != nil {
						return err
					}
				}
			}
			if destinations == 0 {
				return fmt.Errorf("connector %s: usage has no downstream pipeline", id)
			}
		}
		reached[name] = true
		return nil
	}
	for name, p := range cfg.Service.Pipelines {
		for _, id := range p.Receivers {
			if componentType(id) == Type+"_connector" {
				if err := visit(name, true); err != nil {
					return err
				}
			}
		}
	}
	// A shared exporter, or an external source into a publication connector,
	// would let customer telemetry consume usage queue capacity.
	for name, p := range cfg.Service.Pipelines {
		if reached[name] {
			continue
		}
		for _, id := range p.Exporters {
			if usageExporters[id] {
				return fmt.Errorf("pipeline %s: usage exporter %s must be separate from telemetry", name, id)
			}
			if componentType(id) == Type+"_connector" {
				continue
			}
			if _, ok := cfg.Connectors[id]; !ok {
				continue
			}
			for target, next := range cfg.Service.Pipelines {
				if reached[target] && slices.Contains(next.Receivers, id) {
					return fmt.Errorf("pipeline %s: telemetry must not feed usage publication connector %s", name, id)
				}
			}
		}
	}
	return nil
}

// Both telemetry and usage acknowledge durable queue admission and retry delivery.
func (cfg topologyConfig) validateQueue(id string) error {
	e := cfg.Exporters[id]
	q := e.SendingQueue.Get()
	if !e.SendingQueue.HasValue() || q.WaitForResult || q.StorageID == nil || q.StorageID.Type().String() != "file_storage" {
		return fmt.Errorf("exporter %s: requires a persistent queue and wait_for_result=false", id)
	}
	storage, ok := cfg.Extensions[q.StorageID.String()]
	if !ok || !storage.FSync || !slices.Contains(cfg.Service.Extensions, q.StorageID.String()) {
		return fmt.Errorf("exporter %s: queue file storage must be enabled with fsync=true", id)
	}
	if e.Retry.Enabled == nil || !*e.Retry.Enabled || e.Retry.MaxElapsedTime != 0 {
		return fmt.Errorf("exporter %s: requires unlimited retries", id)
	}
	return nil
}
