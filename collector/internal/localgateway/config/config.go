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
						// A stalled client would otherwise hold shutdown, which
						// waits for in-flight requests. Loopback exports finish
						// in milliseconds, so these never cut off a real one.
						"read_header_timeout": "5s",
						"read_timeout":        "10s",
						"cors": map[string]any{
							"allowed_origins": []any{"*"},
						},
					},
				},
			},
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
					"receivers": []any{"otlp"},
					"exporters": []any{"chdb"},
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
