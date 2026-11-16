package config

import (
	"fmt"
	"net"
	"net/url"
	"time"
)

type CollectorConfig struct {
	OTLPListenAddress string
	TTL               time.Duration
}

// ParseEndpoint validates a loopback HTTP origin and returns its host:port.
func ParseEndpoint(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("parse endpoint: %w", err)
	}
	if u.Scheme != "http" {
		return "", fmt.Errorf("endpoint %q must use http", raw)
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	switch {
	case host == "localhost":
	case ip == nil:
		return "", fmt.Errorf("endpoint %q must use localhost or loopback", raw)
	case !ip.IsLoopback():
		return "", fmt.Errorf("endpoint %q must use localhost or loopback", raw)
	}
	if u.Port() == "" {
		return "", fmt.Errorf("endpoint %q must include a port", raw)
	}
	return u.Host, nil
}

func BuildCollectorConfigMap(cfg CollectorConfig) map[string]any {
	return map[string]any{
		"receivers": map[string]any{
			"otlp": map[string]any{
				"protocols": map[string]any{
					"http": map[string]any{
						"endpoint": cfg.OTLPListenAddress,
						// Shutdown waits for in-flight requests, so a stalled
						// client holds it until these cut the request off. They
						// must stay under the CLI's 3s pipelineStopTimeout, or
						// shutdown gives up and exits without closing chDB.
						// Loopback exports finish in milliseconds.
						"read_header_timeout": "1s",
						"read_timeout":        "1s",
						"cors": map[string]any{
							"allowed_origins": []any{"*"},
						},
					},
				},
			},
		},
		// Errors group by the fingerprint the processor stamps, the same as
		// in the cloud.
		"processors": map[string]any{
			"everr_fingerprint": map[string]any{},
		},
		"exporters": map[string]any{
			"chdb": map[string]any{
				// Every insert creates a part that background merges rewrite,
				// so flush few large batches instead of many small ones.
				"sending_queue": map[string]any{
					"batch": map[string]any{
						"flush_timeout": "2s",
						"min_size":      8192,
					},
				},
				// The same JSON attribute columns as the cloud tables, so the
				// shared explorer queries run unchanged.
				"json": true,
				"ttl":  cfg.TTL.String(),
				// Local tables carry the same names as the cloud's query-facing
				// tables so the shared explorer queries run unchanged.
				"logs_table_name":   "logs",
				"traces_table_name": "traces",
				"metrics_tables": map[string]any{
					"gauge":                 map[string]any{"name": "metrics_gauge"},
					"sum":                   map[string]any{"name": "metrics_sum"},
					"histogram":             map[string]any{"name": "metrics_histogram"},
					"exponential_histogram": map[string]any{"name": "metrics_exponential_histogram"},
					"summary":               map[string]any{"name": "metrics_summary"},
				},
			},
		},
		"service": map[string]any{
			"pipelines": map[string]any{
				"traces": map[string]any{
					"receivers": []any{"otlp"},
					"exporters": []any{"chdb"},
				},
				"logs": map[string]any{
					"receivers":  []any{"otlp"},
					"processors": []any{"everr_fingerprint"},
					"exporters":  []any{"chdb"},
				},
				"metrics": map[string]any{
					"receivers": []any{"otlp"},
					"exporters": []any{"chdb"},
				},
			},
			"telemetry": map[string]any{
				"metrics": map[string]any{"level": "none"},
				"logs":    map[string]any{"level": "warn"},
			},
		},
	}
}
