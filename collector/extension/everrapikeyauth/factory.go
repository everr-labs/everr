package everrapikeyauth

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
)

const typeStr = "everr_apikey"

// NewFactory returns the factory for the everr_apikey auth extension.
func NewFactory() extension.Factory {
	return extension.NewFactory(
		component.MustNewType(typeStr),
		createDefaultConfig,
		createExtension,
		component.StabilityLevelDevelopment,
	)
}

func createDefaultConfig() component.Config {
	return &Config{
		Timeout:          defaultTimeout,
		CacheTTL:         defaultCacheTTL,
		NegativeCacheTTL: defaultNegativeCacheTTL,
		CacheSize:        defaultCacheSize,
	}
}

func createExtension(_ context.Context, settings extension.Settings, cfg component.Config) (extension.Extension, error) {
	return newExtension(cfg.(*Config), settings), nil
}
