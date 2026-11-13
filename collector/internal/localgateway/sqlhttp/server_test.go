package sqlhttp

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"go.uber.org/zap"
)

func TestServerStartsAndRoutesSQL(t *testing.T) {
	server := NewServer(Config{Endpoint: "127.0.0.1:0"}, nil, zap.NewNop(), Identity{Version: "0.8.2", InstanceID: "test-instance"})
	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() {
		if err := server.Shutdown(context.Background()); err != nil {
			t.Fatalf("Shutdown() error = %v", err)
		}
	})

	req, _ := http.NewRequest(http.MethodGet, "http://"+server.listener.Addr().String()+"/sql", nil)
	req.Header.Set(LocalHeader, "1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /sql error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
}

func TestServerReportsReadinessOnSQLListener(t *testing.T) {
	server := NewServer(Config{Endpoint: "127.0.0.1:0"}, nil, zap.NewNop(), Identity{Version: "0.8.2", InstanceID: "test-instance"})
	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = server.Shutdown(context.Background()) })
	url := "http://" + server.listener.Addr().String() + "/health"
	for _, state := range []struct {
		set    Status
		code   int
		status string
	}{
		{StatusStarting, http.StatusServiceUnavailable, "starting"},
		{StatusOK, http.StatusOK, "ok"},
		{StatusStopped, http.StatusServiceUnavailable, "stopped"},
	} {
		server.SetStatus(state.set)
		resp, err := http.Get(url)
		if err != nil {
			t.Fatalf("GET /health error = %v", err)
		}
		var body map[string]any
		err = json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()
		if body["service"] != "everr-local-collector" || body["version"] != "0.8.2" || body["instance_id"] != "test-instance" || body["protocol_version"] != float64(1) {
			t.Fatalf("unexpected identity: %v", body)
		}
		if err != nil || resp.StatusCode != state.code || body["status"] != state.status {
			t.Fatalf("readiness = (%d, %v, %v), want (%d, %s)", resp.StatusCode, body, err, state.code, state.status)
		}
	}
}

func TestSQLRejectsRequestsAWebPageCouldSend(t *testing.T) {
	server := NewServer(Config{Endpoint: "127.0.0.1:0"}, nil, zap.NewNop(), Identity{Version: "0.8.2", InstanceID: "test-instance"})
	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = server.Shutdown(context.Background()) })
	url := "http://" + server.listener.Addr().String() + "/sql"
	for name, set := range map[string]func(*http.Request){
		"missing header": func(*http.Request) {},
		"browser origin": func(r *http.Request) {
			r.Header.Set(LocalHeader, "1")
			r.Header.Set("Origin", "https://evil.example")
		},
		"rebound host": func(r *http.Request) {
			r.Header.Set(LocalHeader, "1")
			r.Host = "rebind.evil.example"
		},
	} {
		req, _ := http.NewRequest(http.MethodPost, url, strings.NewReader("SELECT 1"))
		req.Header.Set("Content-Type", "text/plain")
		set(req)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s: status = %d, want 403", name, resp.StatusCode)
		}
	}
}
