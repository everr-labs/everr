package everrapikeyauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
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

// TestAuthenticate_Singleflight_Coalesces is the load-bearing test for the
// burst case: many goroutines miss the cache simultaneously for the same
// token; only one verify call should escape to the upstream.
func TestAuthenticate_Singleflight_Coalesces(t *testing.T) {
	var calls int32
	release := make(chan struct{})
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		<-release // block until all goroutines are queued behind singleflight
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1"})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	const N = 32
	var wg sync.WaitGroup
	errs := make(chan error, N)
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := e.Authenticate(context.Background(), authHeaders("burst"))
			errs <- err
		}()
	}

	// Give the goroutines a beat to all queue behind singleflight before we
	// release the verify server. Brief sleep is the only realistic way to do
	// this without exposing singleflight internals.
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("auth failed: %v", err)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("expected 1 verify call across %d goroutines, got %d", N, got)
	}
}

// TestAuthenticate_StaleFallback_OnTransientError covers the case where the
// verify endpoint goes down briefly: we keep accepting tokens we recently
// verified, within a grace window, instead of returning 401 for keys that
// are actually still valid.
func TestAuthenticate_StaleFallback_OnTransientError(t *testing.T) {
	var phase atomic.Int32 // 0 = succeed, 1 = transient 5xx
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		if phase.Load() == 0 {
			_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	// Prime the cache with a successful verification.
	if _, err := e.Authenticate(context.Background(), authHeaders("known")); err != nil {
		t.Fatalf("priming verify failed: %v", err)
	}

	// Force the cached entry to be "expired" (so the cache won't return it
	// from a normal get) but still within the stale-fallback grace window.
	e.cache.pos.now = func() time.Time {
		return time.Now().Add(e.cfg.CacheTTL + 1*time.Second)
	}
	e.cache.now = e.cache.pos.now

	// Verify endpoint now returns 5xx — without the fallback, this should
	// fail. With it, the stale cache entry should be served.
	phase.Store(1)
	if _, err := e.Authenticate(context.Background(), authHeaders("known")); err != nil {
		t.Fatalf("stale fallback should have served cached entry; got %v", err)
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
