package sqlhttp

import (
	"context"
	"encoding/json"
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

func TestServerReportsReadinessOnSQLListener(t *testing.T) {
	server := NewServer(Config{Endpoint: "127.0.0.1:0"}, nil, zap.NewNop())
	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = server.Shutdown(context.Background()) })
	url := "http://" + server.listener.Addr().String() + "/health"
	for _, state := range []struct {
		ready  bool
		code   int
		status string
	}{
		{false, http.StatusServiceUnavailable, "starting"},
		{true, http.StatusOK, "ok"},
		{false, http.StatusServiceUnavailable, "starting"},
	} {
		server.SetReady(state.ready)
		resp, err := http.Get(url)
		if err != nil {
			t.Fatalf("GET /health error = %v", err)
		}
		var body map[string]string
		err = json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()
		if err != nil || resp.StatusCode != state.code || body["status"] != state.status {
			t.Fatalf("readiness = (%d, %v, %v), want (%d, %s)", resp.StatusCode, body, err, state.code, state.status)
		}
	}
}
