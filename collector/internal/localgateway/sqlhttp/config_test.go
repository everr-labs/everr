package sqlhttp

import (
	"testing"
	"time"
)

func TestConfigAppliedDefaults(t *testing.T) {
	t.Parallel()

	got := Config{
		Endpoint: "127.0.0.1:54320",
	}.Applied()

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
