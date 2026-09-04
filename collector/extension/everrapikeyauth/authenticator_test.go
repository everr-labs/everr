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
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_42", KeyID: "ak_1", LogsDays: 14, TracesDays: 14, MetricsDays: 14})
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
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1", LogsDays: 14, TracesDays: 14, MetricsDays: 14})
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
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1", LogsDays: 14, TracesDays: 14, MetricsDays: 14})
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
			_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1", LogsDays: 14, TracesDays: 14, MetricsDays: 14})
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

// TestAuthenticate_NoStaleFallback_OnMissingRetention covers an app that is
// reachable but broken: it answers 200 without retention. The grace window is
// for an unreachable app, so a warm cache must not paper over this.
func TestAuthenticate_NoStaleFallback_OnMissingRetention(t *testing.T) {
	var phase atomic.Int32 // 0 = complete answer, 1 = answer without retention
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		res := verifyResponse{TenantID: "org_1", KeyID: "ak_1", LogsDays: 14, TracesDays: 14, MetricsDays: 14}
		if phase.Load() == 1 {
			res.LogsDays, res.TracesDays, res.MetricsDays = 0, 0, 0
		}
		_ = json.NewEncoder(w).Encode(res)
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	if _, err := e.Authenticate(context.Background(), authHeaders("known")); err != nil {
		t.Fatalf("priming verify failed: %v", err)
	}

	// Expired for a normal get, but inside the stale-fallback grace window.
	e.cache.pos.now = func() time.Time {
		return time.Now().Add(e.cfg.CacheTTL + 1*time.Second)
	}
	e.cache.now = e.cache.pos.now

	phase.Store(1)
	if _, err := e.Authenticate(context.Background(), authHeaders("known")); err == nil {
		t.Fatal("expected authentication to fail when the app reports no retention")
	}

	// Not cached as a failure either: the app recovers on the next request.
	phase.Store(0)
	if _, err := e.Authenticate(context.Background(), authHeaders("known")); err != nil {
		t.Fatalf("expected recovery once the app answers correctly; got %v", err)
	}
}

func TestAuthenticate_ForwardsOrigin(t *testing.T) {
	var got struct {
		Key    string `json:"key"`
		Origin string `json:"origin"`
	}
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode verify body: %v", err)
		}
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1", LogsDays: 14, TracesDays: 14, MetricsDays: 14})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	headers := authHeaders("tok")
	headers["Origin"] = []string{"https://app.example.com"}
	if _, err := e.Authenticate(context.Background(), headers); err != nil {
		t.Fatal(err)
	}
	if got.Key != "tok" || got.Origin != "https://app.example.com" {
		t.Fatalf("verify body: %+v", got)
	}
}

func TestAuthenticate_LowercaseOriginHeader(t *testing.T) {
	// gRPC metadata arrives lowercased.
	var got struct {
		Origin string `json:"origin"`
	}
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1", LogsDays: 14, TracesDays: 14, MetricsDays: 14})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	headers := authHeaders("tok")
	headers["origin"] = []string{"https://app.example.com"}
	if _, err := e.Authenticate(context.Background(), headers); err != nil {
		t.Fatal(err)
	}
	if got.Origin != "https://app.example.com" {
		t.Fatalf("origin not forwarded from lowercase header: %+v", got)
	}
}

func TestAuthenticate_NoOrigin_OmitsField(t *testing.T) {
	var raw map[string]any
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&raw)
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1", LogsDays: 14, TracesDays: 14, MetricsDays: 14})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	if _, err := e.Authenticate(context.Background(), authHeaders("tok")); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["origin"]; ok {
		t.Fatalf("origin should be omitted for headerless requests, got %v", raw["origin"])
	}
}

// The cache must key by (key, origin): the same key from two origins is two
// independent verdicts, and repeats of either must not re-verify.
func TestAuthenticate_CachePerOrigin(t *testing.T) {
	var calls int32
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1", LogsDays: 14, TracesDays: 14, MetricsDays: 14})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	withOrigin := func(origin string) map[string][]string {
		h := authHeaders("tok")
		h["Origin"] = []string{origin}
		return h
	}
	sequence := []map[string][]string{
		withOrigin("https://a.example"),
		withOrigin("https://b.example"),
		withOrigin("https://a.example"),
		withOrigin("https://b.example"),
		authHeaders("tok"), // no origin: a third distinct cache entry
		authHeaders("tok"),
	}
	for i, h := range sequence {
		if _, err := e.Authenticate(context.Background(), h); err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Fatalf("expected 3 verify calls (a, b, headerless), got %d", got)
	}
}

// A negative verdict for one origin must not poison other origins.
func TestAuthenticate_NegativeCachePerOrigin(t *testing.T) {
	var calls int32
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		var body struct {
			Origin string `json:"origin"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Origin == "https://evil.example" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_1", KeyID: "ak_1", LogsDays: 14, TracesDays: 14, MetricsDays: 14})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	withOrigin := func(origin string) map[string][]string {
		h := authHeaders("tok")
		h["Origin"] = []string{origin}
		return h
	}

	for i := 0; i < 3; i++ {
		if _, err := e.Authenticate(context.Background(), withOrigin("https://evil.example")); err == nil {
			t.Fatal("expected rejection for evil origin")
		}
	}
	if _, err := e.Authenticate(context.Background(), withOrigin("https://good.example")); err != nil {
		t.Fatalf("good origin should pass: %v", err)
	}
	// 1 verify for evil (then negative-cached) + 1 for good.
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("expected 2 verify calls, got %d", got)
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

func TestAuthenticate_Success_StampsRetention(t *testing.T) {
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(verifyResponse{
			TenantID: "org_42", KeyID: "ak_1",
			LogsDays: 30, TracesDays: 30, MetricsDays: 395,
		})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	ctx, err := e.Authenticate(context.Background(), authHeaders("good"))
	if err != nil {
		t.Fatal(err)
	}
	cl := client.FromContext(ctx)
	for name, want := range map[string]string{
		"retention_logs_days":    "30",
		"retention_traces_days":  "30",
		"retention_metrics_days": "395",
	} {
		if got := cl.Auth.GetAttribute(name); got != want {
			t.Errorf("%s: got %v want %s", name, got, want)
		}
	}
	if names := cl.Auth.GetAttributeNames(); len(names) != 5 {
		t.Errorf("attribute names: got %v", names)
	}
}

// Fail closed: a row can only exist with a retention stamp, so an app that
// does not return one (an old deploy) must not be allowed to ingest.
func TestAuthenticate_RejectsResponseWithoutRetention(t *testing.T) {
	srv := fakeVerifyServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(verifyResponse{TenantID: "org_42", KeyID: "ak_1"})
	})
	defer srv.Close()
	e := newTestExt(t, srv.URL)

	if _, err := e.Authenticate(context.Background(), authHeaders("good")); err == nil {
		t.Fatal("expected error: a verify response without retention must not authenticate")
	}
}
