package internaltelemetry

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestOnlyDebugReadsTheInternalEndpointOverride(t *testing.T) {
	for _, debug := range []bool{true, false} {
		for _, key := range []string{"", "  ", " internal-key "} {
			var reads []string
			config := resolve(debug, key, func(name string) string {
				reads = append(reads, name)
				return "http://internal-debug.test/"
			}, "http://local.test", SourceCLI)
			if debug {
				if config.Endpoint != "http://internal-debug.test/" || len(config.Headers) != 0 {
					t.Fatalf("debug config = %+v", config)
				}
				if !slices.Equal(reads, []string{"EVERR_INTERNAL_TELEMETRY_ENDPOINT"}) {
					t.Fatalf("reads = %v", reads)
				}
				continue
			}
			if len(reads) != 0 {
				t.Fatalf("release read env: %v", reads)
			}
			if (config != nil) != (strings.TrimSpace(key) != "") {
				t.Fatalf("key %q: config = %+v", key, config)
			}
			if config == nil {
				continue
			}
			if config.Endpoint != cloudEndpoint {
				t.Fatalf("endpoint = %q", config.Endpoint)
			}
			if got := config.Headers.Get("Authorization"); got != "Bearer internal-key" {
				t.Fatalf("authorization = %q", got)
			}
			if got := config.Headers.Get("Origin"); got != CLIPublicOrigin {
				t.Fatalf("origin = %q", got)
			}
		}
	}
}

func TestDebugUsesLocalCollectorWithoutInternalOverride(t *testing.T) {
	for _, override := range []string{"", "  "} {
		config := resolve(true, "ignored", func(string) string { return override }, "http://local.test", SourceCLI)
		if config.Endpoint != "http://local.test" || len(config.Headers) != 0 {
			t.Fatalf("config = %+v", config)
		}
	}
}

func TestCLIAndUIUseDistinctPublicOrigins(t *testing.T) {
	noEnv := func(string) string { return "" }
	for source, origin := range map[Source]string{SourceCLI: "https://cli.everr.local", SourceUI: "https://ui.everr.local"} {
		if got := resolve(false, "internal-key", noEnv, "http://local.test", source).Headers.Get("Origin"); got != origin {
			t.Fatalf("origin = %q, want %q", got, origin)
		}
		if debug := resolve(true, "internal-key", noEnv, "http://local.test", source); len(debug.Headers) != 0 {
			t.Fatalf("debug headers = %v", debug.Headers)
		}
	}
}

func TestReleaseErrorsDoNotExportCustomerInput(t *testing.T) {
	err := fmt.Errorf("query failed: %w", errors.New("SELECT 'customer-secret'"))
	if got := commandErrorForBuild(false, err); got != "CLI command failed" {
		t.Fatalf("release error = %q", got)
	}
	if got := commandErrorForBuild(true, err); !strings.Contains(got, "customer-secret") {
		t.Fatalf("debug error = %q", got)
	}
}

func TestSignalEndpoint(t *testing.T) {
	for base, want := range map[string]string{
		"http://local.test/v1/traces/":   "http://local.test/v1/logs",
		"http://127.0.0.1:54318":         "http://127.0.0.1:54318/v1/logs",
		"http://127.0.0.1:54318/v1/logs": "http://127.0.0.1:54318/v1/logs",
	} {
		if got := SignalEndpoint(base, "logs"); got != want {
			t.Errorf("SignalEndpoint(%q) = %q, want %q", base, got, want)
		}
	}
}
