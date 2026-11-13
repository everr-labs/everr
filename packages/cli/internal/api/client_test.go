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

func TestGetMeParsesIdentity(t *testing.T) {
	srv, hits := serve(t, "GET", "/api/cli/me", 200,
		`{"email":"user@example.test","name":"Test User","organizationName":"Test Org"}`)
	me, err := sessionClient(t, srv.URL).GetMe(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if me.Email != "user@example.test" || me.Name != "Test User" || me.OrganizationName != "Test Org" || me.IngestEndpoint != nil {
		t.Errorf("unexpected identity %+v", me)
	}
	if *hits != 1 {
		t.Errorf("hits = %d", *hits)
	}
}

func TestGetMeRejectsIncompleteIdentity(t *testing.T) {
	srv, _ := serve(t, "GET", "/api/cli/me", 200, `{"email":"ada@example.com"}`)
	_, err := sessionClient(t, srv.URL).GetMe(t.Context())
	if err == nil || !strings.Contains(err.Error(), "decode") {
		t.Fatalf("err = %v, want a decode error", err)
	}
}

func TestGetMeUnauthorizedRequiresReauthentication(t *testing.T) {
	srv, _ := serve(t, "GET", "/api/cli/me", 401, `{"error":"expired"}`)
	_, err := sessionClient(t, srv.URL).GetMe(t.Context())
	if !IsReauthenticationRequired(err) {
		t.Fatalf("err = %v, want reauthentication", err)
	}
	if err.Error() != "Session expired. Run `everr cloud login` to re-authenticate." {
		t.Errorf("message = %q", err)
	}
}

func TestApplyUnauthorizedWithAPIKeyBlamesTheKey(t *testing.T) {
	srv, _ := serve(t, "POST", "/api/apply", 401, `{"error":"unauthorized"}`)
	_, err := tokenClient(t, srv.URL, "bad-token").Apply(t.Context(), &ApplyRequest{Repoid: "repo-1", DryRun: false})
	if err == nil || IsReauthenticationRequired(err) {
		t.Fatalf("err = %v, want an API key error", err)
	}
	assertContains(t, err.Error(), "EVERR_API_KEY")
	assertNotContains(t, err.Error(), "Session expired", "re-authenticate")
}

func TestApplyUnauthorizedWithSessionRequiresReauthentication(t *testing.T) {
	srv, _ := serve(t, "POST", "/api/apply", 401, `{"error":"Unauthenticated"}`)
	_, err := sessionClient(t, srv.URL).Apply(t.Context(), &ApplyRequest{Repoid: "repo-1"})
	if !IsReauthenticationRequired(err) {
		t.Fatalf("err = %v, want reauthentication", err)
	}
	assertContains(t, err.Error(), "everr cloud login")
	assertNotContains(t, err.Error(), "EVERR_API_KEY")
}

func TestApplyFailureSurfacesStatusAndBody(t *testing.T) {
	srv, _ := serve(t, "POST", "/api/apply", 400, `bad.yaml: unknown kind "Gizmo"`)
	_, err := tokenClient(t, srv.URL, "tok").Apply(t.Context(), &ApplyRequest{Repoid: "repo-1"})
	if err == nil || IsReauthenticationRequired(err) {
		t.Fatalf("err = %v", err)
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

func TestListResourcesSendsFiltersAndParses(t *testing.T) {
	var query string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.RawQuery
		io.WriteString(w, `[{"kind":"runbook","project":"default","slug":"oom","repoid":"github.com/acme/app","updatedAt":"2026-07-01T00:00:00.000Z"}]`)
	}))
	defer srv.Close()
	out, err := sessionClient(t, srv.URL).ListResources(t.Context(), "runbook", nil)
	if err != nil {
		t.Fatal(err)
	}
	if query != "kind=runbook" {
		t.Errorf("query = %q", query)
	}
	ui := ""
	if _, err := sessionClient(t, srv.URL).ListResources(t.Context(), "", &ui); err != nil {
		t.Fatal(err)
	}
	if query != "repoid=" {
		t.Errorf("UI-created filter query = %q", query)
	}
	if len(out) != 1 || out[0].Slug != "oom" || out[0].Repoid != "github.com/acme/app" {
		t.Errorf("unexpected resources %+v", out)
	}
}

func TestGetResourceReturnsDocument(t *testing.T) {
	srv, _ := serve(t, "GET", "/api/cli/resources/dashboard/default/errors", 200, `{"kind":"Dashboard","metadata":{"name":"errors"}}`)
	doc, err := sessionClient(t, srv.URL).GetResource(t.Context(), "dashboard", "default", "errors")
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Kind     string `json:"kind"`
		Metadata struct {
			Name string `json:"name"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(doc, &parsed); err != nil || parsed.Kind != "Dashboard" || parsed.Metadata.Name != "errors" {
		t.Errorf("doc = %s, %v", doc, err)
	}
}

func TestDeleteResource(t *testing.T) {
	srv, hits := serve(t, "DELETE", "/api/cli/resources/dashboard/default/errors", 200, `{"ok":true}`)
	if err := sessionClient(t, srv.URL).DeleteResource(t.Context(), "dashboard", "default", "errors"); err != nil {
		t.Fatal(err)
	}
	if *hits != 1 {
		t.Errorf("hits = %d", *hits)
	}

	missing, _ := serve(t, "DELETE", "/api/cli/resources/dashboard/default/nope", 404, `{"error":"resource not found"}`)
	err := sessionClient(t, missing.URL).DeleteResource(t.Context(), "dashboard", "default", "nope")
	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want 404", err)
	}
}

func TestAdoptResourceSendsRepoidAndParsesOutcome(t *testing.T) {
	var body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/cli/resources/dashboard/default/errors/adopt" {
			t.Errorf("path = %s", r.URL.Path)
		}
		data, _ := io.ReadAll(r.Body)
		body = string(data)
		io.WriteString(w, `{"kind":"dashboard","project":"default","slug":"errors","repoid":"github.com/acme/app","alreadyOwned":false}`)
	}))
	defer srv.Close()
	outcome, err := sessionClient(t, srv.URL).AdoptResource(t.Context(), "dashboard", "default", "errors", "github.com/acme/app")
	if err != nil {
		t.Fatal(err)
	}
	if body != `{"repoid":"github.com/acme/app"}` {
		t.Errorf("body = %s", body)
	}
	if outcome.Repoid != "github.com/acme/app" || outcome.AlreadyOwned {
		t.Errorf("unexpected outcome %+v", outcome)
	}
}

func TestPostSQLSendsPlainTextAndReturnsBody(t *testing.T) {
	var contentType, auth, body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentType, auth = r.Header.Get("Content-Type"), r.Header.Get("Authorization")
		data, _ := io.ReadAll(r.Body)
		body = string(data)
		io.WriteString(w, "{\"ok\":1}\n")
	}))
	defer srv.Close()
	out, err := sessionClient(t, srv.URL).PostSQL(t.Context(), "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	if out != "{\"ok\":1}\n" || body != "SELECT 1" || contentType != "text/plain" || auth != "Bearer test-token" {
		t.Errorf("out=%q body=%q content-type=%q auth=%q", out, body, contentType, auth)
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
