package sqlhttp

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	"go.uber.org/zap"
)

func newTestHandler() *handler {
	return &handler{
		queryTimeout:   5 * time.Second,
		enqueueTimeout: 2 * time.Second,
		maxBytes:       16 << 20,
		logger:         zap.NewNop(),
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

func TestHandlerSubstitutesParams(t *testing.T) {
	h := newTestHandler()
	var seen string
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		seen = sql
		return []byte("{}\n"), nil
	}

	req := httptest.NewRequest(
		http.MethodPost,
		`/sql?param_q=%22hello%22&param_levels=%5B%22error%22%5D`,
		strings.NewReader("SELECT * WHERE Body = {q:String} AND Level IN {levels:Array(String)}"),
	)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body=%s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	want := "SELECT * WHERE Body = 'hello' AND Level IN ['error']"
	if seen != want {
		t.Fatalf("sql = %q, want %q", seen, want)
	}
}

func TestHandlerReturnsBadRequestOnMissingParam(t *testing.T) {
	h := newTestHandler()
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		t.Fatalf("exec should not be called")
		return nil, nil
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/sql?param_a=42",
		strings.NewReader("SELECT {missing:String}"),
	)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestHandlerReturnsBadRequestOnMissingParamWithoutAnyParams(t *testing.T) {
	h := newTestHandler()
	h.exec = func(ctx context.Context, sql string) ([]byte, error) {
		t.Fatalf("exec should not be called")
		return nil, nil
	}

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT {missing:String}"))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
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
		return nil, chdb.ErrQueueFull
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

type recordingSession struct {
	mu      sync.Mutex
	queries []string
	failUse bool
}

type rowResult []byte

func (r rowResult) Buf() []byte { return r }
func (rowResult) Free()         {}

func (s *recordingSession) Query(query string, _ ...string) (chdb.Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queries = append(s.queries, query)
	if s.failUse && strings.HasPrefix(query, "USE ") {
		return nil, errors.New("Database analytics does not exist")
	}
	return rowResult("{\"a\":1}\n"), nil
}

func (s *recordingSession) Close()       {}
func (s *recordingSession) Path() string { return "" }

func handlerOnSession(t *testing.T, session *recordingSession) *handler {
	t.Helper()
	chdb.ResetForTesting()
	t.Cleanup(chdb.ResetForTesting)
	handle, err := chdb.Open(t.TempDir(), chdb.WithSessionFactory(func(string) (chdb.Session, error) {
		return session, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	h := newTestHandler()
	h.handle = handle
	h.database = "analytics"
	return h
}

func TestHandlerRunsEachStatementInTheServersDatabase(t *testing.T) {
	session := &recordingSession{}
	h := handlerOnSession(t, session)

	for _, sql := range []string{"USE system", "SELECT 1"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader(sql)))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d, body %s", sql, rec.Code, rec.Body)
		}
	}

	want := []string{"USE analytics", "USE system", "USE analytics", "SELECT 1"}
	if !slices.Equal(session.queries, want) {
		t.Fatalf("queries = %q, want %q", session.queries, want)
	}
}

func TestHandlerDoesNotRunTheStatementWhenTheDatabaseCannotBeSelected(t *testing.T) {
	session := &recordingSession{failUse: true}
	h := handlerOnSession(t, session)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1")))

	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "Database analytics does not exist") {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
	}
	if want := []string{"USE analytics"}; !slices.Equal(session.queries, want) {
		t.Fatalf("queries = %q, want %q", session.queries, want)
	}
}
