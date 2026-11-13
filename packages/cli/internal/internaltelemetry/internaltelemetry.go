// Package internaltelemetry resolves where Everr's own product telemetry goes.
// It is independent of the applications Everr observes: release builds can
// only export to Everr's cloud, and no customer OTEL_* configuration applies.
package internaltelemetry

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/everr-labs/everr/packages/cli/internal/build"
)

const cloudEndpoint = "https://ingest.everr.dev"

// Native callers deliberately use the product origin with an origin-bound
// public ingest key. Never inherit the local browser's origin or a customer key.
const (
	CLIPublicOrigin = "https://cli.everr.local"
	UIPublicOrigin  = "https://ui.everr.local"
)

// ExportTimeout bounds each export request so telemetry never holds up a
// command.
const ExportTimeout = 750 * time.Millisecond

// Set in release builds with
// -ldflags "-X github.com/everr-labs/everr/packages/cli/internal/internaltelemetry.ingestKey=...".
// Debug builds ignore it.
var ingestKey = ""

type Source int

const (
	SourceCLI Source = iota
	SourceUI
)

func (s Source) origin() string {
	if s == SourceUI {
		return UIPublicOrigin
	}
	return CLIPublicOrigin
}

// Config is where internal telemetry is exported. Headers holds the
// authorization header in release builds, so never log it.
type Config struct {
	Endpoint string
	Headers  http.Header
}

// FromEnv returns the export configuration for source, or nil when internal
// telemetry is disabled (a release build without an embedded key).
func FromEnv(source Source) *Config {
	return resolve(!build.Release, ingestKey, os.Getenv, build.OTLPHTTPOrigin(), source)
}

func resolve(debug bool, embeddedKey string, readEnv func(string) string, localEndpoint string, source Source) *Config {
	if debug {
		endpoint := strings.TrimSpace(readEnv("EVERR_INTERNAL_TELEMETRY_ENDPOINT"))
		if endpoint == "" {
			endpoint = localEndpoint
		}
		return &Config{Endpoint: endpoint, Headers: http.Header{}}
	}
	key := strings.TrimSpace(embeddedKey)
	if key == "" {
		return nil
	}
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+key)
	headers.Set("Origin", source.origin())
	return &Config{Endpoint: cloudEndpoint, Headers: headers}
}

// SignalEndpoint is the OTLP/HTTP URL for signal ("traces", "logs", ...):
// /v1/<signal> appended to Endpoint, replacing a signal path it already ends
// with.
func (c *Config) SignalEndpoint(signal string) string {
	base := strings.TrimRight(c.Endpoint, "/")
	for _, name := range []string{"traces", "logs", "metrics"} {
		if trimmed, ok := strings.CutSuffix(base, "/v1/"+name); ok {
			base = trimmed
			break
		}
	}
	return base + "/v1/" + signal
}

func DeploymentEnvironment() string {
	if build.Release {
		return "production"
	}
	return "development"
}

// CommandError is the error message exported for a failed command. Release
// builds use a fixed message to keep customer data out of internal telemetry.
func CommandError(err error) string {
	return commandErrorForBuild(!build.Release, err)
}

func commandErrorForBuild(debug bool, err error) string {
	if debug {
		return err.Error()
	}
	return "CLI command failed"
}
