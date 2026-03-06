package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type stubWriter struct {
	rows []eventRow
	err  error
}

func (w *stubWriter) WriteRows(rows []eventRow) error {
	if w.err != nil {
		return w.err
	}
	w.rows = append(w.rows, rows...)
	return nil
}

func (w *stubWriter) Close() error { return nil }

func TestHandleWebhookRejectsMissingTenant(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodPost, "/webhook/github", strings.NewReader(`{}`))
	req.Header.Set(headerGitHubEvent, "workflow_run")
	req.Header.Set(headerGitHubID, "delivery-1")

	rec := httptest.NewRecorder()
	s := &server{transformer: transformer{}, writer: &stubWriter{}}
	s.handleWebhook(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestHandleWebhookRejectsMalformedPayload(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodPost, "/webhook/github", strings.NewReader(`{`))
	req.Header.Set(headerGitHubEvent, "workflow_run")
	req.Header.Set(headerGitHubID, "delivery-2")
	req.Header.Set(headerTenantID, "42")

	rec := httptest.NewRecorder()
	s := &server{transformer: transformer{}, writer: &stubWriter{}}
	s.handleWebhook(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestHandleWebhookAcceptsSupportedEvent(t *testing.T) {
	t.Parallel()

	writer := &stubWriter{}
	s := &server{transformer: transformer{}, writer: writer}
	req := httptest.NewRequest(http.MethodPost, "/webhook/github", strings.NewReader(`{
		"action":"requested",
		"workflow_run":{
			"id":123,
			"name":"Tests",
			"html_url":"https://github.com/acme/repo/actions/runs/123",
			"head_branch":"main",
			"head_sha":"abc123",
			"created_at":"2026-03-05T10:00:00Z",
			"repository":{"full_name":"acme/repo","html_url":"https://github.com/acme/repo"}
		},
		"repository":{"full_name":"acme/repo","html_url":"https://github.com/acme/repo"}
	}`))
	req.Header.Set(headerGitHubEvent, "workflow_run")
	req.Header.Set(headerGitHubID, "delivery-3")
	req.Header.Set(headerTenantID, "12")

	rec := httptest.NewRecorder()
	s.handleWebhook(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}
	if len(writer.rows) != 1 {
		t.Fatalf("expected 1 written row, got %d", len(writer.rows))
	}
}

func TestHandleWebhookAcceptsUnsupportedEventAsNoOp(t *testing.T) {
	t.Parallel()

	writer := &stubWriter{}
	s := &server{transformer: transformer{}, writer: writer}
	req := httptest.NewRequest(http.MethodPost, "/webhook/github", strings.NewReader(`{"zen":"keep it logically awesome."}`))
	req.Header.Set(headerGitHubEvent, "ping")
	req.Header.Set(headerGitHubID, "delivery-4")
	req.Header.Set(headerTenantID, "12")

	rec := httptest.NewRecorder()
	s.handleWebhook(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}
	if len(writer.rows) != 0 {
		t.Fatalf("expected no written rows, got %d", len(writer.rows))
	}
}

func TestHandleWebhookReturnsServerErrorOnWriterFailure(t *testing.T) {
	t.Parallel()

	s := &server{transformer: transformer{}, writer: &stubWriter{err: errors.New("boom")}}
	req := httptest.NewRequest(http.MethodPost, "/webhook/github", strings.NewReader(`{
		"action":"requested",
		"workflow_run":{
			"id":123,
			"name":"Tests",
			"html_url":"https://github.com/acme/repo/actions/runs/123",
			"head_branch":"main",
			"head_sha":"abc123",
			"created_at":"2026-03-05T10:00:00Z",
			"repository":{"full_name":"acme/repo","html_url":"https://github.com/acme/repo"}
		},
		"repository":{"full_name":"acme/repo","html_url":"https://github.com/acme/repo"}
	}`))
	req.Header.Set(headerGitHubEvent, "workflow_run")
	req.Header.Set(headerGitHubID, "delivery-5")
	req.Header.Set(headerTenantID, "12")

	rec := httptest.NewRecorder()
	s.handleWebhook(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
}
