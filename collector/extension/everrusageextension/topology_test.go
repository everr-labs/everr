package everrusageextension

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/confmap"
)

func admissionConfig() map[string]any {
	return map[string]any{
		"extensions": map[string]any{"file_storage/ingestion": map[string]any{"fsync": true}},
		"service": map[string]any{"extensions": []any{"file_storage/ingestion"}, "pipelines": map[string]any{
			"logs":          map[string]any{"receivers": []any{"otlp"}, "processors": []any{"resource", Type}, "exporters": []any{"storage"}},
			"metrics/usage": map[string]any{"receivers": []any{Type}, "exporters": []any{"storage/usage"}},
		}},
		"exporters": map[string]any{
			"storage":       map[string]any{"sending_queue": map[string]any{"enabled": true, "storage": "file_storage/ingestion", "wait_for_result": false, "queue_size": 10000, "num_consumers": 10, "batch": map[string]any{"min_size": 8192, "flush_timeout": "1s"}}, "retry_on_failure": map[string]any{"enabled": true, "max_elapsed_time": "0s"}},
			"storage/usage": map[string]any{"sending_queue": map[string]any{"enabled": false}, "retry_on_failure": map[string]any{"enabled": false}},
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
		{"batch_before", func(c, p, q, r map[string]any) { p["processors"] = []any{"batch", Type} }},
		{"batch_after", func(c, p, q, r map[string]any) { p["processors"] = []any{Type, "batch"} }},
		{"double_meter", func(c, p, q, r map[string]any) { p["processors"] = []any{Type, Type + "/second"} }},
		{"unknown_processor", func(c, p, q, r map[string]any) { p["processors"] = []any{"custom", Type} }},
		{"connector_before", func(c, p, q, r map[string]any) {
			c["connectors"] = map[string]any{"queue": map[string]any{}}
			p["receivers"] = []any{"queue"}
		}},
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

func TestPublicationTopology(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(map[string]any, map[string]any)
	}{
		{"queue", func(p, e map[string]any) { e["sending_queue"] = map[string]any{"enabled": true} }},
		{"retry", func(p, e map[string]any) { e["retry_on_failure"] = map[string]any{"enabled": true} }},
		{"implicit_retry", func(p, e map[string]any) { delete(e, "retry_on_failure") }},
		{"processor", func(p, e map[string]any) { p["processors"] = []any{"resource"} }},
		{"mixed_receiver", func(p, e map[string]any) { p["receivers"] = []any{Type, "otlp"} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := admissionConfig()
			p := c["service"].(map[string]any)["pipelines"].(map[string]any)["metrics/usage"].(map[string]any)
			e := c["exporters"].(map[string]any)["storage/usage"].(map[string]any)
			tc.change(p, e)
			require.Error(t, validateTopology(confmap.NewFromStringMap(c)))
		})
	}
}

func TestReceiverFanoutRejected(t *testing.T) {
	for _, source := range []string{"logs", "metrics/usage"} {
		t.Run(source, func(t *testing.T) {
			c := admissionConfig()
			pipelines := c["service"].(map[string]any)["pipelines"].(map[string]any)
			pipelines[componentType(source)+"/copy"] = pipelines[source]
			require.Error(t, validateTopology(confmap.NewFromStringMap(c)))
		})
	}
}

func TestEffectiveOptionalQueueConfig(t *testing.T) {
	c := admissionConfig()
	exporters := c["exporters"].(map[string]any)
	// The Collector marshals enabled optional sections without an enabled key,
	// and disabled optional sections as nil in the effective snapshot.
	delete(exporters["storage"].(map[string]any)["sending_queue"].(map[string]any), "enabled")
	exporters["storage/usage"].(map[string]any)["sending_queue"] = nil
	require.NoError(t, validateTopology(confmap.NewFromStringMap(c)))
}
