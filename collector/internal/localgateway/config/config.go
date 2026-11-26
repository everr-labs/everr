package config

import (
	"fmt"
	"net"
	"net/url"
)

type CollectorConfig struct {
	OTLPListenAddress string
	RetentionDays     uint16
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
							// The WebSDK gzips recording Segments. Content-Encoding
							// is not CORS-safelisted, and the default list lacks it.
							"allowed_headers": []any{"Authorization", "Content-Type", "Content-Encoding"},
						},
					},
				},
			},
		},
		"connectors": map[string]any{
			// Segments are close to 1 MB, so they go to app.recordings, as on a
			// server installation, and not to the logs table. Move, not copy:
			// error_mode propagate fails the batch on a broken condition
			// instead of sliding Segments into the logs table.
			"routing": map[string]any{
				"default_pipelines": []any{"logs/telemetry"},
				"error_mode":        "propagate",
				"table": []any{
					map[string]any{
						"condition": `log.event_name == "everr.browser.recording.segment"`,
						"pipelines": []any{"logs/recordings"},
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
				"retention_days": cfg.RetentionDays,
			},
			"chdb/recordings": map[string]any{
				// One request is one Segment of about 1 MB, held in memory, so
				// the queue counts requests and stays small: the default of 1000
				// could hold 1 GB and outlast the CLI's 3s pipelineStopTimeout.
				// A full queue refuses the Segment and the browser sends it
				// again. The batch is the server collector's.
				"sending_queue": map[string]any{
					"sizer":      "requests",
					"queue_size": 32,
					"batch": map[string]any{
						"sizer":         "items",
						"flush_timeout": "1s",
						"min_size":      16,
						"max_size":      16,
					},
				},
				"retention_days": cfg.RetentionDays,
				"recordings":     true,
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
					"exporters": []any{"routing"},
				},
				"logs/telemetry": map[string]any{
					"receivers": []any{"routing"},
					"exporters": []any{"chdb"},
				},
				"logs/recordings": map[string]any{
					"receivers": []any{"routing"},
					"exporters": []any{"chdb/recordings"},
				},
				"metrics": map[string]any{
					"receivers": []any{"otlp"},
					"exporters": []any{"chdb"},
				},
				"profiles": map[string]any{
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
