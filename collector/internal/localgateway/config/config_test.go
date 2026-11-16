package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/confmap"
)

func TestParseEndpointRequiresLocalHTTPURL(t *testing.T) {
	address, err := ParseEndpoint("http://127.0.0.1:54318")
	require.NoError(t, err)
	require.Equal(t, "127.0.0.1:54318", address)

	_, err = ParseEndpoint("https://127.0.0.1:54318")
	require.ErrorContains(t, err, "must use http")

	_, err = ParseEndpoint("http://example.com:54318")
	require.ErrorContains(t, err, "must use localhost or loopback")
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
