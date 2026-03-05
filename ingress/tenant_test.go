package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/go-github/v67/github"
	"go.uber.org/zap"
)

func int64Ptr(v int64) *int64 { return &v }

func TestInstallationIDFromWebhookEvent(t *testing.T) {
	t.Parallel()

	id, err := installationIDFromWebhookEvent(&github.WorkflowRunEvent{Installation: &github.Installation{ID: int64Ptr(123)}})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if id != int64(123) {
		t.Fatalf("unexpected id: %d", id)
	}

	_, err = installationIDFromWebhookEvent(&github.WorkflowRunEvent{})
	if err == nil {
		t.Fatalf("expected missing installation error")
	}
}

func TestTenantCacheTTL(t *testing.T) {
	t.Parallel()

	cache := newTenantCache(30 * time.Millisecond)
	cache.set(55, 777)

	tenantID, ok := cache.get(55)
	if !ok || tenantID != 777 {
		t.Fatalf("expected cache hit with tenant 777, got hit=%v tenant=%d", ok, tenantID)
	}

	time.Sleep(40 * time.Millisecond)
	_, ok = cache.get(55)
	if ok {
		t.Fatalf("expected cache miss after TTL expiry")
	}
}

func TestResolveTenantIDFromAPIAndCache(t *testing.T) {
	t.Parallel()

	var requests atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if got := r.URL.Query().Get("installation_id"); got != "123" {
			t.Fatalf("unexpected installation_id query: %q", got)
		}
		timestamp := r.Header.Get(headerIngressTimestamp)
		if timestamp == "" {
			t.Fatalf("missing ingress timestamp header")
		}
		gotSignature := r.Header.Get(headerIngressSignatureSHA256)
		wantSignature := signIngressRequest("test-secret", timestamp, r.Method, r.URL.RequestURI())
		if gotSignature != wantSignature {
			t.Fatalf("invalid ingress signature: got %q want %q", gotSignature, wantSignature)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tenant_id":42}`))
	}))
	defer ts.Close()

	resolver := newTenantResolver(ts.URL, "test-secret", ts.Client(), time.Minute, zap.NewNop().Named("tenant_resolver"))

	first, err := resolver.ResolveTenantID(context.Background(), 123)
	if err != nil {
		t.Fatalf("unexpected resolve error: %v", err)
	}
	if first != 42 {
		t.Fatalf("expected tenant 42, got %d", first)
	}

	second, err := resolver.ResolveTenantID(context.Background(), 123)
	if err != nil {
		t.Fatalf("unexpected resolve error on cached call: %v", err)
	}
	if second != 42 {
		t.Fatalf("expected tenant 42 from cache, got %d", second)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("expected exactly one API call with cache enabled, got %d", got)
	}
}

func TestResolveTenantIDReturnsTerminalErrorFor4xx(t *testing.T) {
	t.Parallel()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "missing mapping", http.StatusNotFound)
	}))
	defer ts.Close()

	resolver := newTenantResolver(ts.URL, "test-secret", ts.Client(), 0, zap.NewNop().Named("tenant_resolver"))
	_, err := resolver.ResolveTenantID(context.Background(), 123)
	if err == nil {
		t.Fatalf("expected error for 4xx tenant resolution response")
	}

	var terr *terminalError
	if !errors.As(err, &terr) {
		t.Fatalf("expected terminalError, got %T (%v)", err, err)
	}
}

func TestResolveTenantIDReturnsRetryableErrorFor5xx(t *testing.T) {
	t.Parallel()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
	}))
	defer ts.Close()

	resolver := newTenantResolver(ts.URL, "test-secret", ts.Client(), 0, zap.NewNop().Named("tenant_resolver"))
	_, err := resolver.ResolveTenantID(context.Background(), 123)
	if err == nil {
		t.Fatalf("expected error for 5xx tenant resolution response")
	}

	var terr *terminalError
	if errors.As(err, &terr) {
		t.Fatalf("expected non-terminal retryable error, got terminalError")
	}
}
