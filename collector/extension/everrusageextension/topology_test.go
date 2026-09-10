package everrusageextension

import (
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
			"metrics/usage": map[string]any{"receivers": []any{Type + "_connector"}, "exporters": []any{"storage"}},
		}},
		"exporters": map[string]any{
			"storage": map[string]any{"sending_queue": map[string]any{"enabled": true, "storage": "file_storage/ingestion", "wait_for_result": false, "queue_size": 10000, "num_consumers": 10, "batch": map[string]any{"min_size": 8192, "flush_timeout": "1s"}}, "retry_on_failure": map[string]any{"enabled": true, "max_elapsed_time": "0s"}},
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
	pipelines["metrics/usage"].(map[string]any)["processors"] = []any{"custom"}
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
