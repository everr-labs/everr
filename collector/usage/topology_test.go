package usage

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/confmap"
)

func TestTopology(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(map[string]any, map[string]any)
		valid  bool
	}{
		{name: "durable_queue_before_meter", valid: true},
		{name: "synchronous_storage", valid: true, change: func(_ map[string]any, e map[string]any) { e["sending_queue"] = map[string]any{"enabled": false} }},
		{name: "queue_ack", change: func(_ map[string]any, e map[string]any) { e["sending_queue"] = map[string]any{"enabled": true} }},
		{name: "persistent_queue", change: func(_ map[string]any, e map[string]any) {
			e["sending_queue"] = map[string]any{"enabled": true, "wait_for_result": true, "storage": "file_storage"}
		}},
		{name: "fanout", change: func(p, e map[string]any) { p["exporters"] = []any{"storage", "debug"} }},
		{name: "buffer_after_meter", change: func(p, e map[string]any) { p["processors"] = []any{Type, "batch"} }},
		{name: "direct_ingress", change: func(p, e map[string]any) { p["receivers"] = []any{"otlp"} }},
		{name: "buffer_before_meter", change: func(p, e map[string]any) { p["processors"] = []any{"batch", Type} }},
		{name: "storage_retries", change: func(p, e map[string]any) { e["retry_on_failure"] = map[string]any{"enabled": true} }},
		{name: "meter_twice", change: func(p, e map[string]any) { p["processors"] = []any{Type, Type + "/second"} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := map[string]any{"receivers": []any{"everr_queue"}, "processors": []any{Type}, "exporters": []any{"storage"}}
			e := map[string]any{"sending_queue": map[string]any{"enabled": false}}
			if tc.change != nil {
				tc.change(p, e)
			}
			err := validateTopology(confmap.NewFromStringMap(map[string]any{"service": map[string]any{"pipelines": map[string]any{"logs": p}}, "exporters": map[string]any{"storage": e}, "connectors": map[string]any{"everr_queue": map[string]any{}}}))
			if tc.valid {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
	for _, tc := range []struct {
		name                    string
		queue, retry, processor bool
		valid                   bool
	}{
		{name: "one_attempt", valid: true}, {name: "retries", retry: true}, {name: "buffer", queue: true}, {name: "processor", processor: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := map[string]any{"receivers": []any{Type}, "exporters": []any{"storage"}}
			if tc.processor {
				p["processors"] = []any{"batch"}
			}
			e := map[string]any{"sending_queue": map[string]any{"enabled": tc.queue}, "retry_on_failure": map[string]any{"enabled": tc.retry}}
			err := validateTopology(confmap.NewFromStringMap(map[string]any{"service": map[string]any{"pipelines": map[string]any{"metrics/usage": p}}, "exporters": map[string]any{"storage": e}, "connectors": map[string]any{"everr_queue": map[string]any{}}}))
			if tc.valid {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}

func TestQueueRoutingSafety(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(map[string]any)
	}{
		{"two_destinations", func(p map[string]any) { p["logs/second"] = p["logs/storage"] }},
		{"unmetered_destination", func(p map[string]any) { p["logs/storage"].(map[string]any)["processors"] = []any{} }},
		{"source_fanout", func(p map[string]any) { p["logs/source"].(map[string]any)["exporters"] = []any{"everr_queue", "debug"} }},
		{"source_batch", func(p map[string]any) { p["logs/source"].(map[string]any)["processors"] = []any{"batch"} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pipelines := map[string]any{
				"logs/source":  map[string]any{"receivers": []any{"otlp"}, "exporters": []any{"everr_queue"}},
				"logs/storage": map[string]any{"receivers": []any{"everr_queue"}, "processors": []any{Type}, "exporters": []any{"storage"}},
			}
			tc.change(pipelines)
			cfg := map[string]any{"service": map[string]any{"pipelines": pipelines}, "connectors": map[string]any{"everr_queue": map[string]any{}}, "exporters": map[string]any{"storage": map[string]any{}}}
			require.Error(t, validateTopology(confmap.NewFromStringMap(cfg)))
		})
	}
}
