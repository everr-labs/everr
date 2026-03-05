package main

import (
	"testing"
	"time"

	"github.com/google/go-github/v67/github"
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
