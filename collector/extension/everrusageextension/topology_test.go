package everrusageextension

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/confmap"
)

func admissionConfig() map[string]any {
	return map[string]any{
		"connectors": map[string]any{Type + "_connector": map[string]any{}},
		"extensions": map[string]any{"file_storage/ingestion": map[string]any{"fsync": true}},
		"service": map[string]any{"extensions": []any{"file_storage/ingestion"}, "pipelines": map[string]any{
			"logs":          map[string]any{"receivers": []any{"otlp"}, "processors": []any{"resource", Type}, "exporters": []any{"storage", Type + "_connector"}},
			"metrics/usage": map[string]any{"receivers": []any{Type + "_connector"}, "processors": []any{"delta_to_cumulative/usage"}, "exporters": []any{"storage/usage"}},
		}},
		"exporters": map[string]any{
			"storage":       map[string]any{"sending_queue": map[string]any{"enabled": true, "storage": "file_storage/ingestion", "wait_for_result": false, "queue_size": 10000, "num_consumers": 10, "batch": map[string]any{"min_size": 8192, "flush_timeout": "1s"}}, "retry_on_failure": map[string]any{"enabled": true, "max_elapsed_time": "0s"}},
			"storage/usage": map[string]any{"sending_queue": map[string]any{"enabled": true, "storage": "file_storage/ingestion", "wait_for_result": false, "block_on_overflow": true, "queue_size": 10000, "num_consumers": 10, "batch": map[string]any{"min_size": 8192, "flush_timeout": "1s"}}, "retry_on_failure": map[string]any{"enabled": true, "max_elapsed_time": "0s"}},
		},
	}
}

func TestAdmissionTopology(t *testing.T) {
	require.NoError(t, validateTopology(confmap.NewFromStringMap(admissionConfig())))
	for _, tc := range []struct {
		name   string
		change func(map[string]any, map[string]any, map[string]any, map[string]any)
	}{
		{"fanout", func(c, p, q, r map[string]any) { p["exporters"] = []any{"storage", "debug"} }},
		{"missing_exporter", func(c, p, q, r map[string]any) { p["exporters"] = []any{"connector"} }},
		{"batch_after", func(c, p, q, r map[string]any) { p["processors"] = []any{Type, "batch"} }},
		{"double_meter", func(c, p, q, r map[string]any) { p["processors"] = []any{Type, Type + "/second"} }},
		{"disabled_queue", func(c, p, q, r map[string]any) { q["enabled"] = false }},
		{"missing_queue", func(c, p, q, r map[string]any) {
			delete(c["exporters"].(map[string]any)["storage"].(map[string]any), "sending_queue")
		}},
		{"wait_for_result", func(c, p, q, r map[string]any) { q["wait_for_result"] = true }},
		{"memory_queue", func(c, p, q, r map[string]any) { delete(q, "storage") }},
		{"missing_storage", func(c, p, q, r map[string]any) { q["storage"] = "file_storage/missing" }},
		{"no_fsync", func(c, p, q, r map[string]any) {
			c["extensions"].(map[string]any)["file_storage/ingestion"] = map[string]any{"fsync": false}
		}},
		{"disabled_storage", func(c, p, q, r map[string]any) { c["service"].(map[string]any)["extensions"] = []any{} }},
		{"no_retries", func(c, p, q, r map[string]any) { r["enabled"] = false }},
		{"finite_retries", func(c, p, q, r map[string]any) { r["max_elapsed_time"] = "1m" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := admissionConfig()
			p := c["service"].(map[string]any)["pipelines"].(map[string]any)["logs"].(map[string]any)
			e := c["exporters"].(map[string]any)["storage"].(map[string]any)
			tc.change(c, p, e["sending_queue"].(map[string]any), e["retry_on_failure"].(map[string]any))
			require.Error(t, validateTopology(confmap.NewFromStringMap(c)))
		})
	}
}

func TestComposition(t *testing.T) {
	c := admissionConfig()
	c["connectors"].(map[string]any)["forward"] = map[string]any{}
	pipelines := c["service"].(map[string]any)["pipelines"].(map[string]any)
	p := pipelines["logs"].(map[string]any)
	p["receivers"] = []any{"forward"}
	p["processors"] = []any{"custom", "batch", Type}
	pipelines["logs/copy"] = p
	pipelines["metrics/usage"].(map[string]any)["processors"] = []any{"custom", "delta_to_cumulative/usage"}
	require.NoError(t, validateTopology(confmap.NewFromStringMap(c)))
	pipelines["metrics/usage"].(map[string]any)["processors"] = []any{Type}
	require.ErrorContains(t, validateTopology(confmap.NewFromStringMap(c)), "bypass metering")
}

func TestEffectiveOptionalQueueConfig(t *testing.T) {
	c := admissionConfig()
	exporters := c["exporters"].(map[string]any)
	// The Collector marshals enabled optional sections without an enabled key,
	// and disabled optional sections as nil in the effective snapshot.
	delete(exporters["storage"].(map[string]any)["sending_queue"].(map[string]any), "enabled")
	require.NoError(t, validateTopology(confmap.NewFromStringMap(c)))
}

func TestConnectorTopology(t *testing.T) {
	connectorConfig := admissionConfig
	require.NoError(t, validateTopology(confmap.NewFromStringMap(connectorConfig())))
	for _, tc := range []struct {
		name   string
		change func(map[string]any, map[string]any)
	}{
		{"missing_input_edge", func(c, pipes map[string]any) {
			pipes["traces"] = map[string]any{"receivers": []any{"otlp"}, "processors": []any{Type}, "exporters": []any{"storage"}}
		}},
		{"different_meter", func(c, pipes map[string]any) {
			c["connectors"].(map[string]any)[Type+"_connector"] = map[string]any{"extension": Type + "/other"}
		}},
		{"unmetered_input", func(c, pipes map[string]any) { delete(pipes["logs"].(map[string]any), "processors") }},
		{"publication_loop", func(c, pipes map[string]any) { pipes["metrics/usage"].(map[string]any)["processors"] = []any{Type} }},
		{"two_publication_pipelines", func(c, pipes map[string]any) { pipes["metrics/other"] = pipes["metrics/usage"] }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := connectorConfig()
			pipes := c["service"].(map[string]any)["pipelines"].(map[string]any)
			tc.change(c, pipes)
			require.Error(t, validateTopology(confmap.NewFromStringMap(c)))
		})
	}
}

func TestPublicationTopology(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(map[string]any, map[string]any, map[string]any, map[string]any)
	}{
		{"missing_conversion", func(c, p, q, r map[string]any) { delete(p, "processors") }},
		{"double_conversion", func(c, p, q, r map[string]any) {
			p["processors"] = []any{"delta_to_cumulative/one", "delta_to_cumulative/two"}
		}},
		{"shared_exporter", func(c, p, q, r map[string]any) {
			p["exporters"] = []any{"storage"}
			c["exporters"].(map[string]any)["storage"].(map[string]any)["sending_queue"].(map[string]any)["block_on_overflow"] = true
		}},
		{"disabled_queue", func(c, p, q, r map[string]any) { q["enabled"] = false }},
		{"memory_queue", func(c, p, q, r map[string]any) { delete(q, "storage") }},
		{"nonblocking", func(c, p, q, r map[string]any) { q["block_on_overflow"] = false }},
		{"wait_for_result", func(c, p, q, r map[string]any) { q["wait_for_result"] = true }},
		{"no_fsync", func(c, p, q, r map[string]any) {
			c["extensions"].(map[string]any)["file_storage/usage"] = map[string]any{"fsync": false}
			q["storage"] = "file_storage/usage"
			c["service"].(map[string]any)["extensions"] = []any{"file_storage/ingestion", "file_storage/usage"}
		}},
		{"missing_storage", func(c, p, q, r map[string]any) { q["storage"] = "file_storage/missing" }},
		{"no_retry", func(c, p, q, r map[string]any) { r["enabled"] = false }},
		{"finite_retry", func(c, p, q, r map[string]any) { r["max_elapsed_time"] = "1m" }},
		{"mixed_receivers", func(c, p, q, r map[string]any) { p["receivers"] = []any{Type + "_connector", "otlp"} }},
		{"unknown_output", func(c, p, q, r map[string]any) { p["exporters"] = []any{"missing"} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := admissionConfig()
			p := c["service"].(map[string]any)["pipelines"].(map[string]any)["metrics/usage"].(map[string]any)
			e := c["exporters"].(map[string]any)["storage/usage"].(map[string]any)
			tc.change(c, p, e["sending_queue"].(map[string]any), e["retry_on_failure"].(map[string]any))
			require.Error(t, validateTopology(confmap.NewFromStringMap(c)))
		})
	}
}

func TestPublicationFanout(t *testing.T) {
	config := func() map[string]any {
		c := admissionConfig()
		c["connectors"].(map[string]any)["forward/usage"] = map[string]any{}
		pipes := c["service"].(map[string]any)["pipelines"].(map[string]any)
		pipes["metrics/usage"].(map[string]any)["exporters"] = []any{"forward/usage"}
		pipes["metrics/customer"] = map[string]any{"receivers": []any{"forward/usage"}, "exporters": []any{"storage/usage"}}
		pipes["metrics/admin"] = map[string]any{"receivers": []any{"forward/usage"}, "processors": []any{"resource/admin"}, "exporters": []any{"storage/usage"}}
		return c
	}
	require.NoError(t, validateTopology(confmap.NewFromStringMap(config())))
	for _, tc := range []struct {
		name   string
		change func(map[string]any)
	}{
		{"meter_downstream", func(p map[string]any) { p["metrics/admin"].(map[string]any)["processors"] = []any{Type} }},
		{"conversion_after_fanout", func(p map[string]any) {
			delete(p["metrics/usage"].(map[string]any), "processors")
			p["metrics/admin"].(map[string]any)["processors"] = []any{"delta_to_cumulative"}
		}},
		{"second_conversion", func(p map[string]any) {
			p["metrics/admin"].(map[string]any)["processors"] = []any{"delta_to_cumulative"}
		}},
		{"cycle", func(p map[string]any) { p["metrics/admin"].(map[string]any)["exporters"] = []any{"forward/usage"} }},
		{"mixed_input", func(p map[string]any) {
			p["metrics/customer_input"] = map[string]any{"receivers": []any{"otlp"}, "exporters": []any{"forward/usage"}}
		}},
		{"other_signal", func(p map[string]any) { p["logs/admin"] = p["metrics/admin"]; delete(p, "metrics/admin") }},
		{"unused_connector", func(p map[string]any) { delete(p, "metrics/admin"); delete(p, "metrics/customer") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := config()
			tc.change(c["service"].(map[string]any)["pipelines"].(map[string]any))
			require.Error(t, validateTopology(confmap.NewFromStringMap(c)))
		})
	}
}

func TestPublicationRootCannotAlsoBeDownstream(t *testing.T) {
	for _, converted := range []bool{false, true} {
		t.Run(fmt.Sprint("converted=", converted), func(t *testing.T) {
			c := admissionConfig()
			connectors := c["connectors"].(map[string]any)
			connectors[Type+"_connector/second"] = map[string]any{"extension": Type + "/second"}
			connectors["forward/usage"] = map[string]any{}
			c["processors"] = map[string]any{Type + "/second": map[string]any{"extension": Type + "/second"}}
			pipes := c["service"].(map[string]any)["pipelines"].(map[string]any)
			pipes["logs/second"] = map[string]any{"receivers": []any{"otlp"}, "processors": []any{Type + "/second"}, "exporters": []any{"storage", Type + "_connector/second"}}
			pipes["metrics/usage"].(map[string]any)["exporters"] = []any{"forward/usage"}
			mixed := map[string]any{"receivers": []any{Type + "_connector/second", "forward/usage"}, "exporters": []any{"storage/usage"}}
			if converted {
				mixed["processors"] = []any{"delta_to_cumulative/second"}
			}
			pipes["metrics/mixed"] = mixed
			accepted := 0
			for range 1000 {
				if validateTopology(confmap.NewFromStringMap(c)) == nil {
					accepted++
				}
			}
			require.Zero(t, accepted, "publication roots must never also consume another publication pipeline")
			// Independent roots remain valid, including a shared usage exporter.
			mixed["receivers"] = []any{Type + "_connector/second"}
			mixed["processors"] = []any{"delta_to_cumulative/second"}
			pipes["metrics/usage"].(map[string]any)["exporters"] = []any{"storage/usage"}
			require.NoError(t, validateTopology(confmap.NewFromStringMap(c)))
		})
	}
}
