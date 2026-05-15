package everrapikeyauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/extension"
)

func newTestExt(t *testing.T, endpoint string) *ext {
	t.Helper()
	cfg := &Config{
		Endpoint:     endpoint,
		SharedSecret: "test-secret",
	}
	return newExtension(cfg, extension.Settings{})
}

// fakeVerifyServer returns an httptest server returning canned responses.
func fakeVerifyServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(handler)
}

func authHeaders(token string) map[string][]string {
	return map[string][]string{"Authorization": {"Bearer " + token}}
}

func TestAuthenticate_MissingHeader(t *testing.T) {
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("verify should not be called")
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	_, err := e.Authenticate(context.Background(), map[string][]string{})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestAuthenticate_BadScheme(t *testing.T) {
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	_, err := e.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Basic abc"},
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestAuthenticate_InvalidKey(t *testing.T) {
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	_, err := e.Authenticate(context.Background(), authHeaders("bad"))
	if err == nil {
		t.Fatal("expected unauthorized")
	}
}

func TestAuthenticate_Success_StampsAuthData(t *testing.T) {
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-internal-secret") != "test-secret" {
			http.Error(w, "missing secret", http.StatusForbidden)
			return
		}
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_42", KeyID: "ak_1"})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	ctx, err := e.Authenticate(context.Background(), authHeaders("good"))
	if err != nil {
		t.Fatal(err)
	}
	cl := client.FromContext(ctx)
	if cl.Auth == nil {
		t.Fatal("Auth not set")
	}
	if got := cl.Auth.GetAttribute("tenant_id"); got != "org_42" {
		t.Errorf("tenant_id: got %v", got)
	}
	if got := cl.Auth.GetAttribute("key_id"); got != "ak_1" {
		t.Errorf("key_id: got %v", got)
	}
}

func TestAuthenticate_CacheHit_AvoidsSecondCall(t *testing.T) {
	var calls int32
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1"})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	for i := 0; i < 3; i++ {
		_, err := e.Authenticate(context.Background(), authHeaders("good"))
		if err != nil {
			t.Fatal(err)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("expected 1 verify call, got %d", got)
	}
}

func TestAuthenticate_NegativeCache(t *testing.T) {
	var calls int32
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusUnauthorized)
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	for i := 0; i < 5; i++ {
		_, err := e.Authenticate(context.Background(), authHeaders("bad"))
		if err == nil {
			t.Fatal("expected error")
		}
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("expected 1 verify call (negative cache), got %d", got)
	}
}

// guard: Timeout config plumbs to http client.
func TestExtension_TimeoutWiring(t *testing.T) {
	cfg := &Config{Endpoint: "http://x", SharedSecret: "s", Timeout: 500 * time.Millisecond}
	e := newExtension(cfg, extension.Settings{})
	if e.httpClient.Timeout != 500*time.Millisecond {
		t.Fatalf("got %v", e.httpClient.Timeout)
	}
}
