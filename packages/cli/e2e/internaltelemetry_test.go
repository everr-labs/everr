package e2e

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestCommandExportIgnoresCustomerOTLPConfiguration(t *testing.T) {
	var mu sync.Mutex
	requests := map[string]int{}
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "application/x-protobuf" ||
			r.Header.Get("Authorization") != "" || r.Header.Get("X-Customer") != "" ||
			r.Header.Get("Content-Encoding") != "" {
			t.Errorf("unexpected export request headers: %v", r.Header)
		}
		mu.Lock()
		requests[r.URL.Path]++
		mu.Unlock()
	}))
	defer internal.Close()
	customer := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		t.Errorf("customer endpoint received %s %s", r.Method, r.URL.Path)
	}))
	defer customer.Close()

	env := NewEnv(t).
		Setenv("EVERR_INTERNAL_TELEMETRY_ENDPOINT", internal.URL).
		Setenv("EVERR_INGEST_KEY", "customer-key").
		Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", customer.URL).
		Setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Bearer customer-key,x-customer=secret").
		Setenv("OTEL_EXPORTER_OTLP_COMPRESSION", "gzip").
		Setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc").
		Setenv("OTEL_EXPORTER_OTLP_TIMEOUT", "0")
	for _, signal := range []string{"TRACES", "LOGS"} {
		env.Setenv("OTEL_EXPORTER_OTLP_"+signal+"_ENDPOINT", customer.URL).
			Setenv("OTEL_EXPORTER_OTLP_"+signal+"_HEADERS", "Authorization=Bearer customer-key,x-customer=secret").
			Setenv("OTEL_EXPORTER_OTLP_"+signal+"_COMPRESSION", "unsupported").
			Setenv("OTEL_EXPORTER_OTLP_"+signal+"_PROTOCOL", "grpc").
			Setenv("OTEL_EXPORTER_OTLP_"+signal+"_TIMEOUT", "0")
	}
	env.Run("skills", "list", "--project").Success(t)

	mu.Lock()
	defer mu.Unlock()
	if requests["/v1/traces"] != 1 {
		t.Errorf("trace exports = %d, want 1", requests["/v1/traces"])
	}
	if requests["/v1/logs"] < 2 {
		t.Errorf("log exports = %d, want at least 2", requests["/v1/logs"])
	}
}
