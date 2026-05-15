package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/confmap"
)

func TestParseEndpointRequiresLocalHTTPURL(t *testing.T) {
	endpoint, err := ParseEndpoint("http://127.0.0.1:54318")
	require.NoError(t, err)
	require.Equal(t, "127.0.0.1:54318", endpoint.ListenAddress)

	_, err = ParseEndpoint("https://127.0.0.1:54318")
	require.ErrorContains(t, err, "must use http")

	_, err = ParseEndpoint("http://example.com:54318")
	require.ErrorContains(t, err, "must use localhost or loopback")
}

func TestBuildCollectorConfigUsesLocalDefaults(t *testing.T) {
	cfg := CollectorConfig{
		OTLPListenAddress: "127.0.0.1:54318",
		TTL:               7 * 24 * time.Hour,
	}

	conf := BuildCollectorConfig(cfg)
	raw := conf.ToStringMap()

	processors := raw["processors"].(map[string]any)
	batch := processors["batch"].(map[string]any)
	require.Equal(t, "250ms", batch["timeout"])
	require.Equal(t, 512, batch["send_batch_size"])

	exporters := raw["exporters"].(map[string]any)
	chdb := exporters["chdb"].(map[string]any)
	require.Equal(t, "168h0m0s", chdb["ttl"])
	require.NotContains(t, chdb, "path")
}

func TestStaticProviderReturnsGeneratedConfig(t *testing.T) {
	raw := BuildCollectorConfigMap(CollectorConfig{
		OTLPListenAddress: "127.0.0.1:54318",
		TTL:               7 * 24 * time.Hour,
	})
	factory := NewStaticProviderFactory(raw)
	provider := factory.Create(confmap.ProviderSettings{})

	retrieved, err := provider.Retrieve(t.Context(), "everr:local", nil)
	require.NoError(t, err)
	defer func() { _ = retrieved.Close(t.Context()) }()

	conf, err := retrieved.AsConf()
	require.NoError(t, err)
	require.NotNil(t, conf)
}
