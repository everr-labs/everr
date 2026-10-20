package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/config/confighttp"
	"go.opentelemetry.io/collector/confmap"

	localconfig "github.com/everr-labs/everr/collector/internal/localgateway/config"
)

func TestParseOptionsUsesLocalDefaults(t *testing.T) {
	opts, err := parseOptions([]string{
		"--otlp-http-endpoint", "http://127.0.0.1:54318",
		"--sql-http-endpoint", "http://127.0.0.1:54320",
		"--chdb-path", "/tmp/everr/chdb",
	})

	require.NoError(t, err)
	require.Equal(t, "127.0.0.1:54318", opts.OTLP.ListenAddress)
	require.Equal(t, "127.0.0.1:54320", opts.SQL.ListenAddress)
	require.Equal(t, "/tmp/everr/chdb", opts.ChDBPath)
	require.Equal(t, 7*24*time.Hour, opts.TTL)
}

func TestParseOptionsRejectsNonLocalEndpoints(t *testing.T) {
	_, err := parseOptions([]string{
		"--otlp-http-endpoint", "http://example.com:54318",
		"--sql-http-endpoint", "http://127.0.0.1:54320",
		"--chdb-path", "/tmp/everr/chdb",
	})

	require.ErrorContains(t, err, "localhost or loopback")
}

func TestParseOptionsAcceptsDayTTL(t *testing.T) {
	opts, err := parseOptions([]string{
		"--otlp-http-endpoint", "http://127.0.0.1:54318",
		"--sql-http-endpoint", "http://127.0.0.1:54320",
		"--chdb-path", "/tmp/everr/chdb",
		"--ttl", "7d",
	})

	require.NoError(t, err)
	require.Equal(t, 7*24*time.Hour, opts.TTL)
}

// A browser page on another origin sends a preflight before a gzip export.
// Content-Encoding is not a CORS-safelisted header, so the generated local
// gateway config must allow it in the answer.
func TestLocalGatewayAllowsContentEncodingPreflight(t *testing.T) {
	raw := localconfig.BuildCollectorConfigMap(localconfig.CollectorConfig{
		OTLPListenAddress: "127.0.0.1:0",
		TTL:               time.Hour,
	})
	httpRaw := raw["receivers"].(map[string]any)["otlp"].(map[string]any)["protocols"].(map[string]any)["http"].(map[string]any)

	serverConfig := confighttp.NewDefaultServerConfig()
	require.NoError(t, confmap.NewFromStringMap(httpRaw).Unmarshal(&serverConfig))

	ctx := t.Context()
	server, err := serverConfig.ToServer(ctx, nil, componenttest.NewNopTelemetrySettings(), http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	require.NoError(t, err)
	listener, err := serverConfig.ToListener(ctx)
	require.NoError(t, err)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Shutdown(context.Background()) })

	// Browsers send the requested names sorted. application/json is not a
	// safelisted content type, so the gzip export preflight names both headers.
	for _, requested := range []string{"content-encoding", "content-encoding, content-type"} {
		request, err := http.NewRequestWithContext(ctx, http.MethodOptions, "http://"+listener.Addr().String()+"/v1/logs", nil)
		require.NoError(t, err)
		request.Header.Set("Origin", "https://app.example")
		request.Header.Set("Access-Control-Request-Method", "POST")
		request.Header.Set("Access-Control-Request-Headers", requested)

		response, err := http.DefaultClient.Do(request)
		require.NoError(t, err)
		allowed := response.Header.Get("Access-Control-Allow-Headers")
		_ = response.Body.Close()

		require.Equal(t, http.StatusNoContent, response.StatusCode, requested)
		require.Contains(t, strings.ToLower(allowed), "content-encoding", requested)
	}
}
