package config

import (
	"fmt"
	"net"
	"net/url"
	"time"

	"go.opentelemetry.io/collector/confmap"
)

type Endpoint struct {
	Origin        string
	ListenAddress string
}

type CollectorConfig struct {
	OTLPListenAddress string
	TTL               time.Duration
}

func ParseEndpoint(raw string) (Endpoint, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return Endpoint{}, fmt.Errorf("parse endpoint: %w", err)
	}
	if u.Scheme != "http" {
		return Endpoint{}, fmt.Errorf("endpoint %q must use http", raw)
	}
	host := u.Hostname()
	if host != "localhost" && net.ParseIP(host) == nil {
		return Endpoint{}, fmt.Errorf("endpoint %q must use localhost or loopback", raw)
	}
	if ip := net.ParseIP(host); ip != nil && !ip.IsLoopback() {
		return Endpoint{}, fmt.Errorf("endpoint %q must use localhost or loopback", raw)
	}
	if u.Port() == "" {
		return Endpoint{}, fmt.Errorf("endpoint %q must include a port", raw)
	}
	return Endpoint{
		Origin:        fmt.Sprintf("http://%s", u.Host),
		ListenAddress: u.Host,
	}, nil
}

func BuildCollectorConfig(cfg CollectorConfig) *confmap.Conf {
	return confmap.NewFromStringMap(BuildCollectorConfigMap(cfg))
}

func BuildCollectorConfigMap(cfg CollectorConfig) map[string]any {
	if cfg.TTL == 0 {
		cfg.TTL = 7 * 24 * time.Hour
	}

	return map[string]any{
		"receivers": map[string]any{
			"otlp": map[string]any{
				"protocols": map[string]any{
					"http": map[string]any{
						"endpoint": cfg.OTLPListenAddress,
						"cors": map[string]any{
							"allowed_origins": []any{"*"},
						},
					},
				},
			},
		},
		"processors": map[string]any{
			"batch": map[string]any{
				"timeout":         "250ms",
				"send_batch_size": 512,
			},
		},
		"exporters": map[string]any{
			"chdb": map[string]any{
				"ttl": cfg.TTL.String(),
			},
		},
		"service": map[string]any{
			"pipelines": map[string]any{
				"traces": map[string]any{
					"receivers":  []any{"otlp"},
					"processors": []any{"batch"},
					"exporters":  []any{"chdb"},
				},
				"logs": map[string]any{
					"receivers":  []any{"otlp"},
					"processors": []any{"batch"},
					"exporters":  []any{"chdb"},
				},
				"metrics": map[string]any{
					"receivers":  []any{"otlp"},
					"processors": []any{"batch"},
					"exporters":  []any{"chdb"},
				},
			},
			"telemetry": map[string]any{
				"metrics": map[string]any{"level": "none"},
				"logs":    map[string]any{"level": "warn"},
			},
		},
	}
}
