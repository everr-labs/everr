package sqlhttp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAllowedOriginContainsNoWildcard(t *testing.T) {
	// The SQL endpoint answers arbitrary reads over local telemetry and has no
	// authentication: loopback binding is the security model. A wildcard would
	// let any page in any tab read it.
	for _, origin := range defaultAllowedOrigins {
		if strings.Contains(origin, "*") {
			t.Fatalf("allowed origin %q contains a wildcard", origin)
		}
	}
}

func TestPreflightFromAllowedOrigin(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodOptions, "/sql", nil)
	req.Header.Set("Origin", "https://app.everr.dev")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.everr.dev" {
		t.Fatalf("allow-origin = %q, want the matched origin echoed", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodPost) {
		t.Fatalf("allow-methods = %q, want it to include POST", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(strings.ToLower(got), "content-type") {
		t.Fatalf("allow-headers = %q, want it to include content-type", got)
	}
	if got := rec.Header().Get("Vary"); !strings.Contains(got, "Origin") {
		t.Fatalf("vary = %q, want it to include Origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("allow-credentials = %q, want it unset", got)
	}
}

// A public origin reaching a private address needs this header or Chrome fails
// the preflight, which is the whole hosted-app half of the feature.
func TestPreflightAnswersPrivateNetworkAccess(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodOptions, "/sql", nil)
	req.Header.Set("Origin", "https://app.everr.dev")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Private-Network", "true")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Private-Network"); got != "true" {
		t.Fatalf("allow-private-network = %q, want \"true\"", got)
	}
}

func TestPreflightFromDisallowedOrigin(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodOptions, "/sql", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("allow-origin = %q, want it unset for a disallowed origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Private-Network"); got != "" {
		t.Fatalf("allow-private-network = %q, want it unset for a disallowed origin", got)
	}
}

func TestPostFromAllowedOriginEchoesOrigin(t *testing.T) {
	h := newTestHandler()
	h.exec = func(_ context.Context, _ string) ([]byte, error) {
		return []byte("{\"n\":1}\n"), nil
	}

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1"))
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("allow-origin = %q, want the matched origin echoed", got)
	}
	if got := rec.Header().Get("Vary"); !strings.Contains(got, "Origin") {
		t.Fatalf("vary = %q, want it to include Origin", got)
	}
	if body := rec.Body.String(); body != "{\"n\":1}\n" {
		t.Fatalf("body = %q, want the query result", body)
	}
}

// 127.0.0.1 and localhost are different origins to a browser, and the dev env
// is reachable at both.
func TestPostFromLoopbackSpellingOfDevOrigin(t *testing.T) {
	h := newTestHandler()
	h.exec = func(_ context.Context, _ string) ([]byte, error) {
		return []byte("{}\n"), nil
	}

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1"))
	req.Header.Set("Origin", "http://127.0.0.1:5173")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5173" {
		t.Fatalf("allow-origin = %q, want the matched origin echoed", got)
	}
}

func TestPostFromDisallowedOriginGetsNoAllowHeader(t *testing.T) {
	h := newTestHandler()
	h.exec = func(_ context.Context, _ string) ([]byte, error) {
		return []byte("{}\n"), nil
	}

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1"))
	req.Header.Set("Origin", "https://evil.example.com")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	// The request still executes: CORS is a browser-side rule, and a non-browser
	// caller such as the CLI sends no Origin at all. Withholding the header is
	// what stops a page from reading the response.
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("allow-origin = %q, want it unset for a disallowed origin", got)
	}
}

func TestPostWithoutOriginIsUnaffected(t *testing.T) {
	h := newTestHandler()
	h.exec = func(_ context.Context, _ string) ([]byte, error) {
		return []byte("{}\n"), nil
	}

	req := httptest.NewRequest(http.MethodPost, "/sql", strings.NewReader("SELECT 1"))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("allow-origin = %q, want it unset when no Origin was sent", got)
	}
}

func TestNonPOSTOtherThanOptionsStillRejected(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodGet, "/sql", nil)
	req.Header.Set("Origin", "https://app.everr.dev")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
