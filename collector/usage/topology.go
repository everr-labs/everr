package usage

import (
	"context"
	"fmt"
	"strings"

	"go.opentelemetry.io/collector/confmap"
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
type extensionReference struct {
	Extension string `mapstructure:"extension"`
}

func (r extensionReference) id() string {
	if r.Extension == "" {
		return Type
	}
	return r.Extension
}

func validateTopology(conf *confmap.Conf) error {
	var cfg struct {
		Service struct {
			Pipelines map[string]pipelineConfig `mapstructure:"pipelines"`
		} `mapstructure:"service"`
		Connectors map[string]extensionReference `mapstructure:"connectors"`
		Processors map[string]extensionReference `mapstructure:"processors"`
		Exporters  map[string]struct {
			SendingQueue struct {
				Enabled bool `mapstructure:"enabled"`
			} `mapstructure:"sending_queue"`
			Retry struct {
				Enabled bool `mapstructure:"enabled"`
			} `mapstructure:"retry_on_failure"`
		} `mapstructure:"exporters"`
	}
	if err := conf.Unmarshal(&cfg, confmap.WithIgnoreUnused()); err != nil {
		return err
	}
	destinations := map[string]int{}
	for name, p := range cfg.Service.Pipelines {
		metered, publisher, queued := false, false, false
		for _, id := range p.Processors {
			if componentType(id) == Type {
				metered = true
			}
		}
		for _, id := range p.Receivers {
			switch componentType(id) {
			case Type:
				publisher = true
			case "everr_queue":
				queued = true
				destinations[componentType(name)+"/"+id]++
			}
		}
		for _, id := range p.Exporters {
			if componentType(id) != "everr_queue" {
				continue
			}
			if len(p.Exporters) != 1 {
				return fmt.Errorf("pipeline %s: durable ingestion cannot fan out before storage", name)
			}
			for _, proc := range p.Processors {
				if componentType(proc) == "batch" {
					return fmt.Errorf("pipeline %s: batch before the persistent queue acknowledges unpersisted data", name)
				}
			}
		}
		if queued && !metered {
			return fmt.Errorf("pipeline %s: everr_queue must feed a metering processor", name)
		}
		if !metered && !publisher {
			continue
		}
		if len(p.Exporters) != 1 {
			return fmt.Errorf("pipeline %s: usage requires exactly one storage exporter, without fanout", name)
		}
		e, ok := cfg.Exporters[p.Exporters[0]]
		if !ok {
			return fmt.Errorf("pipeline %s: usage requires a storage exporter, not a connector", name)
		}
		if e.SendingQueue.Enabled || e.Retry.Enabled {
			return fmt.Errorf("pipeline %s: storage and usage exporters require sending_queue.enabled=false and retry_on_failure.enabled=false", name)
		}
		if publisher {
			if componentType(name) != "metrics" || len(p.Receivers) != 1 || len(p.Processors) != 0 {
				return fmt.Errorf("pipeline %s: usage publication must be an isolated metrics pipeline without processors", name)
			}
		} else {
			if len(p.Receivers) != 1 || !queued || len(p.Processors) != 1 {
				return fmt.Errorf("pipeline %s: durable ingestion requires everr_queue -> everr_usage -> synchronous storage", name)
			}
			q, ok := cfg.Connectors[p.Receivers[0]]
			if !ok {
				return fmt.Errorf("pipeline %s: missing everr_queue connector", name)
			}
			if q.id() != cfg.Processors[p.Processors[0]].id() {
				return fmt.Errorf("pipeline %s: queue and meter must use the same usage extension", name)
			}
		}
	}
	for name, count := range destinations {
		if count != 1 {
			return fmt.Errorf("queue %s: exactly one downstream pipeline per signal is required", name)
		}
	}
	return nil
}

func componentType(id string) string { kind, _, _ := strings.Cut(id, "/"); return kind }
