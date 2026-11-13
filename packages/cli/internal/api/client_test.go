package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/everr-labs/everr/packages/cli/internal/session"
)

// serve answers method+path with status and body, and fails the test on any
// other request. It returns how many times the route was hit.
func serve(t *testing.T, method, path string, status int, body string) (*httptest.Server, *int) {
	t.Helper()
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method || r.URL.Path != path {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
			return
		}
		hits++
		w.WriteHeader(status)
		io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &hits
}

func sessionClient(t *testing.T, baseURL string) *Client {
	t.Helper()
	client, err := FromSession(session.Session{APIBaseURL: baseURL, Token: "test-token"})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func tokenClient(t *testing.T, baseURL, token string) *Client {
	t.Helper()
	client, err := FromToken(baseURL, token)
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestApplyUnauthorizedWithAPIKeyBlamesTheKey(t *testing.T) {
	srv, _ := serve(t, "POST", "/api/apply", 401, `{"error":"unauthorized"}`)
	_, err := tokenClient(t, srv.URL, "bad-token").Apply(t.Context(), &ApplyRequest{Repoid: "repo-1", DryRun: false})
	if err == nil {
		t.Fatal("want an API key error")
	}
	assertContains(t, err.Error(), "EVERR_API_KEY")
	assertNotContains(t, err.Error(), "Session expired", "re-authenticate")
}

func TestApplyUnauthorizedWithSessionRequiresReauthentication(t *testing.T) {
	srv, _ := serve(t, "POST", "/api/apply", 401, `{"error":"Unauthenticated"}`)
	_, err := sessionClient(t, srv.URL).Apply(t.Context(), &ApplyRequest{Repoid: "repo-1"})
	if err == nil || err.Error() != "Session expired. Run `everr cloud login` to re-authenticate." {
		t.Fatalf("err = %v, want reauthentication", err)
	}
}

func TestApplyFailureSurfacesStatusAndBody(t *testing.T) {
	srv, _ := serve(t, "POST", "/api/apply", 400, `bad.yaml: unknown kind "Gizmo"`)
	_, err := tokenClient(t, srv.URL, "tok").Apply(t.Context(), &ApplyRequest{Repoid: "repo-1"})
	if err == nil {
		t.Fatal("want an error")
	}
	assertContains(t, err.Error(), "400", "Gizmo")
}

func TestApplySendsEmptyKindsAsListsAndDecodesSummary(t *testing.T) {
	var sent map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&sent); err != nil {
			t.Error(err)
		}
		io.WriteString(w, `{"dryRun":true,"results":[{"kind":"AlertRule","created":[],"updated":[],"deleted":["b"],"note":"preview rules evaluate suppressed"}],"organization":{"id":"org-1","name":"Acme"}}`)
	}))
	defer srv.Close()
	preview := "gio/x"
	summary, err := tokenClient(t, srv.URL, "tok").Apply(t.Context(), &ApplyRequest{Repoid: "repo-1", Preview: &preview, DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	state := sent["state"].(map[string]any)
	for _, kind := range []string{"dashboards", "runbooks", "alerts"} {
		if list, ok := state[kind].([]any); !ok || len(list) != 0 {
			t.Errorf("state.%s = %v, want []", kind, state[kind])
		}
	}
	if _, ok := sent["source"]; ok {
		t.Errorf("source sent although unset: %v", sent)
	}
	if sent["preview"] != preview || sent["dryRun"] != true {
		t.Errorf("unexpected request %v", sent)
	}
	if !summary.DryRun || summary.Organization.Name != "Acme" || *summary.Results[0].Note != "preview rules evaluate suppressed" {
		t.Errorf("unexpected summary %+v", summary)
	}
}

func TestRedirectsAreNotFollowed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/cli/me" {
			t.Errorf("redirect followed to %s", r.URL.Path)
		}
		http.Redirect(w, r, "/elsewhere", http.StatusFound)
	}))
	defer srv.Close()
	_, err := sessionClient(t, srv.URL).GetMe(t.Context())
	if err == nil || !strings.Contains(err.Error(), "302") {
		t.Errorf("err = %v, want a 302 failure", err)
	}
}

func TestTokensThatCannotBeHeadersAreRejected(t *testing.T) {
	if _, err := FromToken("https://example.test", "bad\ntoken"); err == nil {
		t.Fatal("token with a newline was accepted")
	}
}

func assertContains(t *testing.T, got string, wants ...string) {
	t.Helper()
	for _, want := range wants {
		if !strings.Contains(got, want) {
			t.Errorf("%q does not contain %q", got, want)
		}
	}
}

func assertNotContains(t *testing.T, got string, unwanted ...string) {
	t.Helper()
	for _, s := range unwanted {
		if strings.Contains(got, s) {
			t.Errorf("%q contains %q", got, s)
		}
	}
}
