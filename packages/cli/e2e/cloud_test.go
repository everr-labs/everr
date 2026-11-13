package e2e

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// request is what a cloudServer route saw.
type request struct {
	Header http.Header
	Body   string
}

type reply struct {
	Status int
	Body   string
}

// cloudServer answers "METHOD /path" routes and records every request. Any
// request without a route fails the test.
type cloudServer struct {
	*httptest.Server
	mu     sync.Mutex
	routes map[string]reply
	seen   map[string][]request
}

func newCloudServer(t *testing.T, routes map[string]reply) *cloudServer {
	t.Helper()
	s := &cloudServer{routes: routes, seen: map[string][]request{}}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		body, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.seen[key] = append(s.seen[key], request{Header: r.Header.Clone(), Body: string(body)})
		route, ok := s.routes[key]
		s.mu.Unlock()
		if !ok {
			t.Errorf("unexpected request %s", key)
			http.NotFound(w, r)
			return
		}
		status := route.Status
		if status == 0 {
			status = http.StatusOK
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		io.WriteString(w, route.Body)
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *cloudServer) route(key string, r reply) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.routes[key] = r
}

func (s *cloudServer) requests(route string) []request {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.seen[route]
}

// expect fails unless route was hit times times, each with the bearer token.
func (s *cloudServer) expect(t *testing.T, route string, times int, token string) {
	t.Helper()
	got := s.requests(route)
	if len(got) != times {
		t.Errorf("%s hit %d times, want %d", route, len(got), times)
	}
	for _, r := range got {
		if auth := r.Header.Get("Authorization"); token != "" && auth != "Bearer "+token {
			t.Errorf("%s Authorization = %q, want bearer %s", route, auth, token)
		}
	}
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestCloudHelp(t *testing.T) {
	env := NewEnv(t)
	for _, tc := range []struct {
		args           []string
		want, unwanted []string
	}{
		{[]string{"cloud"}, []string{"login", "logout", "query", "Show the current identity, installation URL, and ingestion endpoint"}, []string{"\n  grep", "\n  logs"}},
		{[]string{"cloud", "query"}, []string{"Run read-only SQL against telemetry in the remote installation", "<SQL>", "--format <FORMAT>"}, nil},
		{[]string{"cloud", "status"}, []string{"Usage: everr cloud status", "--json"}, nil},
		{[]string{"cloud", "login"}, []string{"--url"}, []string{"--token"}},
	} {
		out := env.Run(append(tc.args, "--help")...).Success(t).Stdout
		assertContains(t, out, tc.want...)
		assertNotContains(t, out, tc.unwanted...)
	}
}

func TestCloudStatusReportsIdentityWithoutExposingOrChangingTheSession(t *testing.T) {
	for _, endpoint := range []string{"", "https://ingest.example.test"} {
		t.Run(endpoint, func(t *testing.T) {
			identity := map[string]any{"name": "Ada Lovelace", "email": "ada@example.com", "organizationName": "Acme"}
			if endpoint != "" {
				identity["userId"] = "ada"
				identity["organizationId"] = "org-acme"
				identity["ingestEndpoint"] = endpoint
			}
			body, _ := json.Marshal(identity)
			srv := newCloudServer(t, map[string]reply{"GET /api/cli/me": {Body: string(body)}})
			env := NewEnv(t)
			env.WriteSession(srv.URL, "private-session-token")
			saved := readFile(t, env.SessionPath())

			res := env.Run("cloud", "status").Success(t)
			shownEndpoint := endpoint
			if shownEndpoint == "" {
				shownEndpoint = "not configured or unavailable on this server"
			}
			want := "Name: Ada Lovelace\nEmail: ada@example.com\nOrganization: Acme\nInstallation: " + srv.URL +
				"\nIngestion endpoint: " + shownEndpoint + "\n"
			if res.Stdout != want {
				t.Errorf("stdout:\n%s\nwant:\n%s", res.Stdout, want)
			}
			assertNotContains(t, res.Stderr, "private-session-token")

			res = env.Run("cloud", "status", "--json").Success(t)
			assertNotContains(t, res.Stderr, "private-session-token")
			identity["url"] = srv.URL
			if endpoint == "" {
				identity["ingestEndpoint"] = nil
			}
			if got := res.JSON(t); !reflect.DeepEqual(got, identity) {
				t.Errorf("status --json = %v, want %v", got, identity)
			}

			srv.expect(t, "GET /api/cli/me", 2, "private-session-token")
			if string(readFile(t, env.SessionPath())) != string(saved) {
				t.Error("session file changed")
			}
		})
	}
}

func TestCloudCommandsRequireASession(t *testing.T) {
	env := NewEnv(t)
	for _, args := range [][]string{{"cloud", "status"}, {"cloud", "query", "SELECT 1"}} {
		res := env.Run(args...).Failure(t, 1)
		if res.Stdout != "" {
			t.Errorf("%v stdout = %q", args, res.Stdout)
		}
		assertContains(t, res.Stderr, "No active session. Run `everr cloud login`.")
	}
	if _, err := os.Stat(env.SessionPath()); !os.IsNotExist(err) {
		t.Errorf("session file exists: %v", err)
	}
}

func TestCloudStatusReportsAPIErrorsAndKeepsTheSession(t *testing.T) {
	for _, tc := range []struct {
		status  int
		body    string
		message string
	}{
		{401, `{"error":"expired"}`, "Session expired. Run `everr cloud login` to re-authenticate."},
		{500, `{"error":"service unavailable"}`, "service unavailable"},
		{500, "boom", "CLI API request failed with 500 Internal Server Error: boom"},
		{200, `{"email":"ada@example.com"}`, "decode"},
	} {
		t.Run(tc.body, func(t *testing.T) {
			srv := newCloudServer(t, map[string]reply{"GET /api/cli/me": {Status: tc.status, Body: tc.body}})
			env := NewEnv(t).WithAPIBaseURL(srv.URL)
			env.WriteSession(srv.URL, "private-session-token")
			saved := readFile(t, env.SessionPath())

			res := env.Run("cloud", "status").Failure(t, 1)
			if res.Stdout != "" {
				t.Errorf("stdout = %q", res.Stdout)
			}
			assertContains(t, res.Stderr, tc.message)
			assertNotContains(t, res.Stderr, "private-session-token")
			srv.expect(t, "GET /api/cli/me", 1, "private-session-token")
			if string(readFile(t, env.SessionPath())) != string(saved) {
				t.Error("session file changed")
			}
		})
	}
}

func TestCloudStatusReportsTransportFailureAndKeepsTheSession(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	origin := "http://" + listener.Addr().String()
	listener.Close()
	env := NewEnv(t).WithAPIBaseURL(origin)
	env.WriteSession(origin, "private-session-token")
	saved := readFile(t, env.SessionPath())

	res := env.Run("cloud", "status").Failure(t, 1)
	if res.Stdout != "" {
		t.Errorf("stdout = %q", res.Stdout)
	}
	assertContains(t, res.Stderr, "request failed")
	assertNotContains(t, res.Stderr, "private-session-token")
	if string(readFile(t, env.SessionPath())) != string(saved) {
		t.Error("session file changed")
	}
}

// loginRoutes mocks the device flow; tokenStatus 200 grants "new-token".
func loginRoutes(identity string, tokenStatus int) map[string]reply {
	token := `{"access_token":"new-token"}`
	if tokenStatus != 200 {
		token = `{"error":"access_denied"}`
	}
	return map[string]reply{
		"POST /api/auth/device/token": {Status: tokenStatus, Body: token},
		"GET /api/cli/me":             {Body: identity},
	}
}

func newLoginServer(t *testing.T, identity string, tokenStatus int) *cloudServer {
	t.Helper()
	srv := newCloudServer(t, loginRoutes(identity, tokenStatus))
	// The device code reply names the server's own URL, known only once it starts.
	deviceCode, _ := json.Marshal(map[string]any{
		"device_code": "device-secret", "user_code": "CODE",
		"verification_uri": srv.URL + "/device", "expires_in": 60, "interval": 0,
	})
	srv.route("POST /api/auth/device/code", reply{Body: string(deviceCode)})
	return srv
}

func TestLoginReplacesTheSessionWithoutCreatingRepositoryConfiguration(t *testing.T) {
	for name, identity := range map[string]string{
		"legacy server": `{"name":"Alice","email":"alice@example.test","organizationName":"Acme"}`,
		"current server": `{"name":"Alice","email":"alice@example.test","userId":"alice","organizationName":"Acme",` +
			`"organizationId":"org-acme","ingestEndpoint":"https://ingest.example.test"}`,
	} {
		t.Run(name, func(t *testing.T) {
			env := NewEnv(t)
			root := filepath.Join(env.HomeDir, "repo")
			if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
				t.Fatal(err)
			}
			env.WriteSession("https://old.example.test", "old-token")
			srv := newLoginServer(t, identity, 200)

			cmd := env.Command("cloud", "login", "--url", srv.URL, "--no-open")
			cmd.Dir = root
			res := RunCmd(t, cmd).Success(t)
			assertContains(t, res.Stdout, "Logged in as alice@example.test")

			srv.expect(t, "POST /api/auth/device/code", 1, "")
			srv.expect(t, "POST /api/auth/device/token", 1, "")
			srv.expect(t, "GET /api/cli/me", 1, "new-token")
			var saved any
			if err := json.Unmarshal(readFile(t, env.SessionPath()), &saved); err != nil {
				t.Fatal(err)
			}
			want := map[string]any{"session": map[string]any{"api_base_url": srv.URL, "token": "new-token"}}
			if !reflect.DeepEqual(saved, want) {
				t.Errorf("saved session %v, want %v", saved, want)
			}
			if _, err := os.Stat(filepath.Join(root, ".everr")); !os.IsNotExist(err) {
				t.Errorf(".everr was created: %v", err)
			}
		})
	}
}

func TestFailedLoginUsesTheSavedURLAndKeepsThePreviousSession(t *testing.T) {
	env := NewEnv(t)
	srv := newLoginServer(t, `{}`, 400)
	env.WriteSession(srv.URL, "old-token")
	saved := readFile(t, env.SessionPath())

	res := env.Run("cloud", "login", "--no-open")
	if res.Code == 0 {
		t.Fatalf("login succeeded:\n%s", res.Stdout)
	}
	srv.expect(t, "POST /api/auth/device/code", 1, "")
	srv.expect(t, "POST /api/auth/device/token", 1, "")
	srv.expect(t, "GET /api/cli/me", 0, "")
	if string(readFile(t, env.SessionPath())) != string(saved) {
		t.Error("session file changed")
	}
}

func TestLogoutRevokesAndRemovesTheSession(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"POST /api/auth/sign-out": {}})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "old-token")

	assertContains(t, env.Run("cloud", "logout").Success(t).Stdout, "Logged out.")
	srv.expect(t, "POST /api/auth/sign-out", 1, "old-token")
	if _, err := os.Stat(env.SessionPath()); !os.IsNotExist(err) {
		t.Errorf("session file still exists: %v", err)
	}
	assertContains(t, env.Run("cloud", "logout").Success(t).Stdout, "No active session.")
}

func TestCloudQueryPostsSQLAndRendersNDJSONRows(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"POST /api/cli/sql": {Body: "{\"ok\":1}\n"}})
	env := NewEnv(t).WithAPIBaseURL(srv.URL)
	env.WriteSession(srv.URL, "token-sql")

	res := env.Run("cloud", "query", "SELECT 1 AS ok", "--format", "ndjson").Success(t)
	if res.Stdout != "{\"ok\":1}\n" || res.Stderr != "" {
		t.Errorf("stdout %q, stderr %q", res.Stdout, res.Stderr)
	}
	srv.expect(t, "POST /api/cli/sql", 1, "token-sql")
	got := srv.requests("POST /api/cli/sql")[0]
	if got.Body != "SELECT 1 AS ok" || !strings.HasPrefix(got.Header.Get("Content-Type"), "text/plain") {
		t.Errorf("sent body %q with content type %q", got.Body, got.Header.Get("Content-Type"))
	}
}

func TestCloudQuerySurfacesTheErrorEnvelope(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"POST /api/cli/sql": {Status: 400, Body: `{ "error": "Syntax error near nope" }`}})
	env := NewEnv(t).WithAPIBaseURL(srv.URL)
	env.WriteSession(srv.URL, "token-sql")

	res := env.Run("cloud", "query", "SELECT nope")
	if res.Code == 0 {
		t.Fatalf("query succeeded:\n%s", res.Stdout)
	}
	assertContains(t, res.Stderr, "Syntax error near nope")
	srv.expect(t, "POST /api/cli/sql", 1, "token-sql")
}

// The cloud half of remote_commands_use_the_saved_api_url_including_its_path_prefix;
// the resources, ci, and apply halves belong with those commands.
func TestCloudCommandsUseTheSavedURLIncludingItsPathPrefix(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{
		"GET /everr/api/cli/me":   {Body: `{"name":"Alice","email":"alice@example.test","organizationName":"Acme"}`},
		"POST /everr/api/cli/sql": {Body: "{\"value\":1}\n"},
	})
	other := newCloudServer(t, map[string]reply{})
	env := NewEnv(t).WithAPIBaseURL(other.URL)
	env.WriteSession(srv.URL+"/everr", "saved-token")

	env.Run("cloud", "status", "--json").Success(t)
	env.Run("cloud", "query", "SELECT 1").Success(t)
	srv.expect(t, "GET /everr/api/cli/me", 1, "saved-token")
	srv.expect(t, "POST /everr/api/cli/sql", 1, "saved-token")
}
