package everrapikeyauth

import (
	"testing"
	"time"
)

func TestCreateDefaultConfig(t *testing.T) {
	cfg := createDefaultConfig().(*Config)
	if cfg.Timeout != defaultTimeout {
		t.Errorf("Timeout: got %v, want %v", cfg.Timeout, defaultTimeout)
	}
	if cfg.CacheTTL != defaultCacheTTL {
		t.Errorf("CacheTTL: got %v, want %v", cfg.CacheTTL, defaultCacheTTL)
	}
	if cfg.NegativeCacheTTL != defaultNegativeCacheTTL {
		t.Errorf("NegativeCacheTTL: got %v, want %v", cfg.NegativeCacheTTL, defaultNegativeCacheTTL)
	}
	if cfg.CacheSize != defaultCacheSize {
		t.Errorf("CacheSize: got %d, want %d", cfg.CacheSize, defaultCacheSize)
	}
}

func TestConfigValidate(t *testing.T) {
	tests := []struct {
		name    string
		cfg     Config
		wantErr bool
	}{
		{"empty endpoint", Config{SharedSecret: "s"}, true},
		{"empty secret", Config{Endpoint: "http://x"}, true},
		{"valid", Config{Endpoint: "http://x", SharedSecret: "s"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.cfg.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() err=%v, wantErr=%v", err, tt.wantErr)
			}
		})
	}
}

func TestConfigApplied_Defaults(t *testing.T) {
	c := Config{Endpoint: "http://x", SharedSecret: "s"}
	out := c.applied()
	if out.Timeout != defaultTimeout {
		t.Errorf("Timeout default not applied")
	}
	if out.CacheTTL != defaultCacheTTL {
		t.Errorf("CacheTTL default not applied")
	}
}

func TestConfigApplied_Overrides(t *testing.T) {
	c := Config{
		Endpoint:     "http://x",
		SharedSecret: "s",
		Timeout:      5 * time.Second,
	}
	out := c.applied()
	if out.Timeout != 5*time.Second {
		t.Errorf("override not preserved")
	}
}
