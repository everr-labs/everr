package internaltelemetry

import (
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestResolve(t *testing.T) {
	for _, tc := range []struct {
		name     string
		debug    bool
		key      string
		override string
		source   Source
		want     *Config
	}{
		{"debug override", true, "ignored", "http://internal-debug.test/", SourceCLI, &Config{Endpoint: "http://internal-debug.test/", Headers: http.Header{}}},
		{"debug blank override", true, "ignored", "  ", SourceCLI, &Config{Endpoint: "http://local.test", Headers: http.Header{}}},
		{"release without key", false, "  ", "http://internal-debug.test/", SourceCLI, nil},
		{"release CLI", false, " internal-key ", "http://internal-debug.test/", SourceCLI, &Config{Endpoint: cloudEndpoint, Headers: http.Header{
			"Authorization": {"Bearer internal-key"}, "Origin": {"https://cli.everr.local"},
		}}},
		{"release UI", false, "internal-key", "", SourceUI, &Config{Endpoint: cloudEndpoint, Headers: http.Header{
			"Authorization": {"Bearer internal-key"}, "Origin": {"https://ui.everr.local"},
		}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := resolve(tc.debug, tc.key, func(name string) string {
				if !tc.debug || name != "EVERR_INTERNAL_TELEMETRY_ENDPOINT" {
					t.Errorf("read %s", name)
				}
				return tc.override
			}, "http://local.test", tc.source)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("resolve = %+v, want %+v", got, tc.want)
			}
		})
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
		if got := (&Config{Endpoint: base}).SignalEndpoint("logs"); got != want {
			t.Errorf("SignalEndpoint(%q) = %q, want %q", base, got, want)
		}
	}
}
