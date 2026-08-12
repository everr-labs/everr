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

// End to end through a real listener: the handler-level tests can pass while
// the mux or the server wiring drops the headers, and a browser only ever sees
// what comes off the socket.
func TestServerAnswersPreflightOverTheWire(t *testing.T) {
	server := NewServer(Config{Endpoint: "127.0.0.1:0"}, nil, zap.NewNop())
	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() {
		if err := server.Shutdown(context.Background()); err != nil {
			t.Fatalf("Shutdown() error = %v", err)
		}
	})

	url := "http://" + server.listener.Addr().String() + "/sql"
	req, err := http.NewRequest(http.MethodOptions, url, nil)
	if err != nil {
		t.Fatalf("NewRequest error = %v", err)
	}
	req.Header.Set("Origin", "https://app.everr.dev")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Private-Network", "true")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS /sql error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "https://app.everr.dev" {
		t.Fatalf("allow-origin = %q, want the matched origin echoed", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Private-Network"); got != "true" {
		t.Fatalf("allow-private-network = %q, want \"true\"", got)
	}
	if got := resp.Header.Get("Vary"); got == "" {
		t.Fatal("vary is unset, want it to include Origin")
	}
}
