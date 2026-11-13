package build

import (
	"path/filepath"
	"testing"
)

func TestTelemetryDirUsesNamespaceAndDebugSubdir(t *testing.T) {
	t.Setenv("EVERR_TELEMETRY_DIR", "")
	dir, err := TelemetryDir()
	if err != nil {
		t.Fatal(err)
	}
	if got := filepath.Base(dir); got != "telemetry-dev" {
		t.Fatalf("subdir = %q", got)
	}
	if got := filepath.Base(filepath.Dir(dir)); got != "everr" {
		t.Fatalf("namespace = %q", got)
	}
}

func TestDebugBuildHonorsOriginOverrides(t *testing.T) {
	t.Setenv("EVERR_SQL_HTTP_ORIGIN", "http://127.0.0.1:65531")
	t.Setenv("EVERR_OTLP_HTTP_ORIGIN", "http://127.0.0.1:65529")
	if got := HealthcheckEndpoint(); got != "http://127.0.0.1:65531/health" {
		t.Fatalf("healthcheck = %q", got)
	}
	if got := OTLPHTTPOrigin(); got != "http://127.0.0.1:65529" {
		t.Fatalf("otlp = %q", got)
	}
}
