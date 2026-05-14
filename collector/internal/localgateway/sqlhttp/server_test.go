package sqlhttp

import (
	"context"
	"net/http"
	"testing"

	"go.uber.org/zap"
)

func TestServerStartsAndRoutesSQL(t *testing.T) {
	server := NewServer(Config{Endpoint: "127.0.0.1:0"}, nil, zap.NewNop())
	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() {
		if err := server.Shutdown(context.Background()); err != nil {
			t.Fatalf("Shutdown() error = %v", err)
		}
	})

	resp, err := http.Get("http://" + server.listener.Addr().String() + "/sql")
	if err != nil {
		t.Fatalf("GET /sql error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
}
