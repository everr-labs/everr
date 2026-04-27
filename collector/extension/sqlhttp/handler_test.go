package sqlhttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/everr-labs/chdbexporter/chdbhandle"
	"go.uber.org/zap"
)

func newTestHandler() *handler {
	h := &handler{
		queryTimeout:   5 * time.Second,
		enqueueTimeout: 2 * time.Second,
		maxBytes:       16 << 20,
		logger:         zap.NewNop(),
	}
	h.ready.Store(true)
	return h
}

func decodeErrorEnvelope(t *testing.T, body io.Reader) string {
	t.Helper()

	var payload map[string]string
	if err := json.NewDecoder(body).Decode(&payload); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	return payload["error"]
}

func TestHandlerReturns503BeforeReady(t *testing.T) {
	h := newTestHandler()
	h.ready.Store(false)

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1"))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if got := rec.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("Retry-After = %q, want %q", got, "1")
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want %q", got, "application/json")
	}
	if got := decodeErrorEnvelope(t, rec.Body); got != "collector starting" {
		t.Fatalf("error = %q, want %q", got, "collector starting")
	}
}

func TestHandlerRejectsNonPOST(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodGet, "/sql", nil)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandlerHappyPath(t *testing.T) {
	h := newTestHandler()
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		if sql != "SELECT 1" {
			t.Fatalf("sql = %q, want %q", sql, "SELECT 1")
		}
		return []byte("{\"a\":1}\n"), nil
	}

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1"))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/x-ndjson" {
		t.Fatalf("Content-Type = %q, want %q", got, "application/x-ndjson")
	}
	if body := rec.Body.String(); body != "{\"a\":1}\n" {
		t.Fatalf("body = %q, want %q", body, "{\"a\":1}\n")
	}
}

func TestHandlerRejectsReadOnlyViolation(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("INSERT INTO t VALUES (1)"))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestHandlerRejectsRequestBodyOverCap(t *testing.T) {
	h := newTestHandler()
	sql := "SELECT " + strings.Repeat("x", maxRequestBody)

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader(sql))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestHandlerRejectsResultOverCap(t *testing.T) {
	h := newTestHandler()
	h.maxBytes = 4
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		return []byte("{\"a\":\"way too long\"}\n"), nil
	}

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1"))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusRequestEntityTooLarge)
	}
}

func TestHandlerQueueFullReturns503(t *testing.T) {
	h := newTestHandler()
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		return nil, chdbhandle.ErrQueueFull
	}

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1"))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if got := rec.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("Retry-After = %q, want %q", got, "1")
	}
}

func TestHandlerDeadlineExceededReturns503(t *testing.T) {
	h := newTestHandler()
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		return nil, context.DeadlineExceeded
	}

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1"))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if got := rec.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("Retry-After = %q, want %q", got, "1")
	}
}

func TestHandlerChdbErrorReturns500(t *testing.T) {
	h := newTestHandler()
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		return nil, errors.New("column X not found")
	}

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1"))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("column X not found")) {
		t.Fatalf("body = %q, want runtime error in envelope", rec.Body.String())
	}
}
