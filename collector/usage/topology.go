package usage

import (
	"context"
	"fmt"
	"strings"

	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/extension/extensioncapabilities"
)

var _ extensioncapabilities.ConfigSnapshotWatcher = (*Meter)(nil)

// Reject buffering or fanout that would turn downstream success into something
// other than the storage export result, or allow a usage snapshot to be replayed.
func (*Meter) NotifyConfigSnapshot(_ context.Context, snapshot extensioncapabilities.ConfigSnapshot) error {
	return validateTopology(snapshot.Effective())
}

func validateTopology(conf *confmap.Conf) error {
	var cfg struct {
		Service struct {
			Pipelines map[string]struct {
				Receivers  []string `mapstructure:"receivers"`
				Processors []string `mapstructure:"processors"`
				Exporters  []string `mapstructure:"exporters"`
			} `mapstructure:"pipelines"`
		} `mapstructure:"service"`
		Exporters map[string]struct {
			SendingQueue struct {
				Enabled       bool `mapstructure:"enabled"`
				WaitForResult bool `mapstructure:"wait_for_result"`
				Storage       any  `mapstructure:"storage"`
			} `mapstructure:"sending_queue"`
			Retry struct {
				Enabled bool `mapstructure:"enabled"`
			} `mapstructure:"retry_on_failure"`
		} `mapstructure:"exporters"`
	}
	// Effective configuration includes the exporters' default values.
	if err := conf.Unmarshal(&cfg, confmap.WithIgnoreUnused()); err != nil {
		return err
	}
	for name, p := range cfg.Service.Pipelines {
		metered, publisher := false, false
		for i, id := range p.Processors {
			if componentType(id) != Type {
				continue
			}
			if metered || i != len(p.Processors)-1 {
				return fmt.Errorf("pipeline %s: everr_usage must be the last and only metering processor", name)
			}
			metered = true
		}
		for _, id := range p.Receivers {
			if componentType(id) == Type {
				publisher = true
			}
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
		if publisher {
			if componentType(name) != "metrics" || len(p.Receivers) != 1 || len(p.Processors) != 0 {
				return fmt.Errorf("pipeline %s: usage publication must be an isolated metrics pipeline without processors", name)
			}
			if e.SendingQueue.Enabled || e.Retry.Enabled {
				return fmt.Errorf("pipeline %s: usage publication requires sending_queue.enabled=false and retry_on_failure.enabled=false", name)
			}
		} else if e.SendingQueue.Enabled && (!e.SendingQueue.WaitForResult || e.SendingQueue.Storage != nil) {
			return fmt.Errorf("pipeline %s: metering requires an in-memory queue with wait_for_result=true, or no queue", name)
		}
	}
	return nil
}

func componentType(id string) string { kind, _, _ := strings.Cut(id, "/"); return kind }
