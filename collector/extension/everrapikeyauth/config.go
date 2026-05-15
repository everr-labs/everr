package everrapikeyauth

import (
	"errors"
	"time"

	"go.opentelemetry.io/collector/config/configopaque"
)

const (
	defaultTimeout           = 2 * time.Second
	defaultCacheTTL          = 30 * time.Second
	defaultNegativeCacheTTL  = 5 * time.Second
	defaultCacheSize         = 10000
	defaultNegativeCacheSize = 1024
)

// Config controls how the extension authenticates incoming requests against
// the everr verify-key endpoint.
type Config struct {
	// Endpoint is the absolute URL of the everr verify-key endpoint
	// (e.g. http://app/api/internal/verify-key).
	Endpoint string `mapstructure:"endpoint"`

	// SharedSecret is sent as `x-internal-secret` to the verify endpoint.
	// Must match INGEST_VERIFY_SHARED_SECRET on the app side.
	SharedSecret configopaque.String `mapstructure:"shared_secret"`

	// Timeout for HTTP calls to the verify endpoint.
	Timeout time.Duration `mapstructure:"timeout"`

	// CacheTTL is how long to cache successful verifications.
	CacheTTL time.Duration `mapstructure:"cache_ttl"`

	// NegativeCacheTTL is how long to cache failed verifications, to absorb
	// retry storms from clients with bad keys.
	NegativeCacheTTL time.Duration `mapstructure:"negative_cache_ttl"`

	// CacheSize bounds the in-memory cache of successful verifications.
	CacheSize int `mapstructure:"cache_size"`

	// NegativeCacheSize bounds the in-memory cache of failed verifications.
	// Kept separate from CacheSize so a flood of bad tokens can't push out
	// entries for legitimate keys.
	NegativeCacheSize int `mapstructure:"negative_cache_size"`
}

func (c *Config) Validate() error {
	if c.Endpoint == "" {
		return errors.New("endpoint must be set")
	}
	if string(c.SharedSecret) == "" {
		return errors.New("shared_secret must be set")
	}
	return nil
}

func (c *Config) applied() Config {
	out := *c
	if out.Timeout == 0 {
		out.Timeout = defaultTimeout
	}
	if out.CacheTTL == 0 {
		out.CacheTTL = defaultCacheTTL
	}
	if out.NegativeCacheTTL == 0 {
		out.NegativeCacheTTL = defaultNegativeCacheTTL
	}
	if out.CacheSize == 0 {
		out.CacheSize = defaultCacheSize
	}
	if out.NegativeCacheSize == 0 {
		out.NegativeCacheSize = defaultNegativeCacheSize
	}
	return out
}
