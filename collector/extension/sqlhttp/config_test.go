package sqlhttp

import (
	"testing"
	"time"
)

func TestConfigValidate(t *testing.T) {
	t.Parallel()

	if err := (&Config{}).Validate(); err == nil {
		t.Fatal("Validate() error = nil, want missing endpoint/path error")
	}

	cfg := &Config{
		Endpoint: "127.0.0.1:54320",
		Path:     "/tmp/chdb",
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want nil", err)
	}
}

func TestConfigAppliedDefaults(t *testing.T) {
	t.Parallel()

	got := (&Config{
		Endpoint: "127.0.0.1:54320",
		Path:     "/tmp/chdb",
	}).applied()

	if got.QueryTimeout != 5*time.Second {
		t.Fatalf("QueryTimeout = %v, want %v", got.QueryTimeout, 5*time.Second)
	}
	if got.EnqueueTimeout != 2*time.Second {
		t.Fatalf("EnqueueTimeout = %v, want %v", got.EnqueueTimeout, 2*time.Second)
	}
	if got.MaxResultBytes != 16<<20 {
		t.Fatalf("MaxResultBytes = %d, want %d", got.MaxResultBytes, 16<<20)
	}
}

func TestCreateDefaultConfig(t *testing.T) {
	t.Parallel()

	cfg, ok := createDefaultConfig().(*Config)
	if !ok {
		t.Fatalf("createDefaultConfig() type = %T, want *Config", createDefaultConfig())
	}
	if cfg.Endpoint != "127.0.0.1:54320" {
		t.Fatalf("Endpoint = %q, want %q", cfg.Endpoint, "127.0.0.1:54320")
	}
}
