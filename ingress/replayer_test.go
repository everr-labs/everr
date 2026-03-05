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

func TestReplayerAddsTenantHeader(t *testing.T) {
	t.Parallel()

	var gotTenantID string
	var gotEventType string
	var gotConnection string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTenantID = r.Header.Get(headerTenantID)
		gotEventType = r.Header.Get("X-GitHub-Event")
		gotConnection = r.Header.Get("Connection")
		w.WriteHeader(http.StatusAccepted)
	}))
	defer ts.Close()

	replayer := newCollectorReplayer(ts.URL, ts.Client(), zap.NewNop())
	err := replayer.replayEvent(context.Background(), webhookEvent{
		Headers: map[string][]string{
			"X-GitHub-Event": {"workflow_run"},
			"Connection":     {"keep-alive"},
		},
		Body: []byte(`{"ok":true}`),
	}, 42)
	if err != nil {
		t.Fatalf("unexpected replay error: %v", err)
	}

	if gotTenantID != "42" {
		t.Fatalf("expected tenant header 42, got %q", gotTenantID)
	}
	if gotEventType != "workflow_run" {
		t.Fatalf("expected replayed event header, got %q", gotEventType)
	}
	if gotConnection != "" {
		t.Fatalf("expected hop-by-hop header to be stripped, got %q", gotConnection)
	}
}

func TestReplayerReturnsTerminalErrorFor4xx(t *testing.T) {
	t.Parallel()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad request", http.StatusBadRequest)
	}))
	defer ts.Close()

	replayer := newCollectorReplayer(ts.URL, ts.Client(), zap.NewNop())
	err := replayer.replayEvent(context.Background(), webhookEvent{Body: []byte("{}")}, 1)
	if err == nil {
		t.Fatalf("expected replay error")
	}

	var terr *terminalError
	if !errors.As(err, &terr) {
		t.Fatalf("expected terminalError, got %T (%v)", err, err)
	}
}

func TestReplayerReturnsRetryableErrorFor5xx(t *testing.T) {
	t.Parallel()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer ts.Close()

	replayer := newCollectorReplayer(ts.URL, ts.Client(), zap.NewNop())
	err := replayer.replayEvent(context.Background(), webhookEvent{Body: []byte("{}")}, 1)
	if err == nil {
		t.Fatalf("expected replay error")
	}

	var terr *terminalError
	if errors.As(err, &terr) {
		t.Fatalf("expected non-terminal retryable error, got terminalError")
	}
	if got := err.Error(); got == "" {
		t.Fatalf("expected non-empty error")
	}
	const wantPrefix = "collector status=503"
	if got := err.Error(); !strings.HasPrefix(got, wantPrefix) {
		t.Fatalf("expected error prefix %q, got %q", wantPrefix, got)
	}
}
