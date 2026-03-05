package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"
)

func TestInstallForwarderForwardsWebhookHeaders(t *testing.T) {
	t.Parallel()

	var gotEventType string
	var gotDelivery string
	var gotSignature string
	var gotConnection string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotEventType = r.Header.Get("X-GitHub-Event")
		gotDelivery = r.Header.Get("X-GitHub-Delivery")
		gotSignature = r.Header.Get("X-Hub-Signature-256")
		gotConnection = r.Header.Get("Connection")
		w.WriteHeader(http.StatusAccepted)
	}))
	defer ts.Close()

	forwarder := newInstallationEventForwarder(ts.URL, ts.Client(), zap.NewNop())
	err := forwarder.forwardEvent(context.Background(), webhookEvent{
		EventID: "evt_1",
		Headers: map[string][]string{
			"X-GitHub-Event":      {"installation"},
			"X-GitHub-Delivery":   {"delivery_1"},
			"X-Hub-Signature-256": {"sha256=abc"},
			"Connection":          {"keep-alive"},
		},
		Body: []byte(`{"action":"created"}`),
	})
	if err != nil {
		t.Fatalf("unexpected forwarding error: %v", err)
	}

	if gotEventType != "installation" {
		t.Fatalf("expected event type to be forwarded, got %q", gotEventType)
	}
	if gotDelivery != "delivery_1" {
		t.Fatalf("expected delivery id to be forwarded, got %q", gotDelivery)
	}
	if gotSignature != "sha256=abc" {
		t.Fatalf("expected signature header to be forwarded, got %q", gotSignature)
	}
	if gotConnection != "" {
		t.Fatalf("expected hop-by-hop header to be stripped, got %q", gotConnection)
	}
}

func TestInstallForwarderReturnsTerminalErrorFor4xx(t *testing.T) {
	t.Parallel()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad request", http.StatusBadRequest)
	}))
	defer ts.Close()

	forwarder := newInstallationEventForwarder(ts.URL, ts.Client(), zap.NewNop())
	err := forwarder.forwardEvent(context.Background(), webhookEvent{EventID: "evt_1", Body: []byte("{}")})
	if err == nil {
		t.Fatalf("expected forwarding error")
	}

	var terr *terminalError
	if !errors.As(err, &terr) {
		t.Fatalf("expected terminalError, got %T (%v)", err, err)
	}
}

func TestInstallForwarderReturnsRetryableErrorFor5xx(t *testing.T) {
	t.Parallel()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer ts.Close()

	forwarder := newInstallationEventForwarder(ts.URL, ts.Client(), zap.NewNop())
	err := forwarder.forwardEvent(context.Background(), webhookEvent{EventID: "evt_1", Body: []byte("{}")})
	if err == nil {
		t.Fatalf("expected forwarding error")
	}

	var terr *terminalError
	if errors.As(err, &terr) {
		t.Fatalf("expected non-terminal retryable error, got terminalError")
	}
	const wantPrefix = "app status=503"
	if got := err.Error(); !strings.HasPrefix(got, wantPrefix) {
		t.Fatalf("expected error prefix %q, got %q", wantPrefix, got)
	}
}
