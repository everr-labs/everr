package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"testing"

	"github.com/everr-labs/everr/packages/cli/internal/api"
	"github.com/everr-labs/everr/packages/cli/internal/session"
)

func TestDeviceLoginReportsEachTokenOutcome(t *testing.T) {
	const deviceCode = "device-\"code\\with\nescapes"
	for _, tc := range []struct {
		response string
		wantErr  string
	}{
		{`{"access_token":"test-token"}`, ""},
		{`{"error":"access_denied"}`, "device authentication was denied"},
		{`{"error":"expired_token"}`, "device authentication token expired"},
		{`{"error":"invalid_grant"}`, "device authentication failed: invalid_grant"},
	} {
		t.Run(tc.response, func(t *testing.T) {
			// A successful login first sees the pending and slow_down answers.
			interim := []string{}
			if tc.wantErr == "" {
				interim = []string{"authorization_pending", "slow_down"}
			}
			polls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/auth/device/code":
					json.NewEncoder(w).Encode(map[string]any{
						"device_code": deviceCode, "user_code": "USER-CODE",
						"verification_uri": "http://example.test/verify", "expires_in": 60, "interval": 0,
					})
				case "/api/auth/device/token":
					var body map[string]string
					json.NewDecoder(r.Body).Decode(&body)
					want := map[string]string{
						"grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
						"device_code": deviceCode,
						"client_id":   "everr-desktop",
					}
					if !reflect.DeepEqual(body, want) {
						t.Errorf("token request body %v, want %v", body, want)
					}
					polls++
					if polls <= len(interim) {
						w.WriteHeader(400)
						json.NewEncoder(w).Encode(map[string]string{"error": interim[polls-1]})
						return
					}
					if tc.wantErr != "" {
						w.WriteHeader(400)
					}
					io.WriteString(w, tc.response)
				default:
					t.Errorf("unexpected request %s", r.URL.Path)
				}
			}))
			defer srv.Close()

			got, err := AuthorizeWithPrompt(t.Context(), srv.URL, func(verificationURL *url.URL, code string) {
				if verificationURL.String() != "http://example.test/verify" || code != "USER-CODE" {
					t.Errorf("prompt got %s %s", verificationURL, code)
				}
			})
			if polls != len(interim)+1 {
				t.Errorf("polled %d times, want %d", polls, len(interim)+1)
			}
			if tc.wantErr != "" {
				if err == nil || err.Error() != tc.wantErr {
					t.Fatalf("err = %v, want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Token != "test-token" || got.APIBaseURL != srv.URL {
				t.Errorf("session = %+v", got)
			}
		})
	}
}

func TestBlankDeviceTokensAreRejected(t *testing.T) {
	_, err := sessionFromDeviceToken("https://app.everr.dev", "   ")
	if err == nil || err.Error() != "received an empty access token" {
		t.Fatalf("err = %v", err)
	}
}

func TestNormalizeURL(t *testing.T) {
	for in, want := range map[string]string{
		" https://App.Everr.dev:443/ ":  "https://app.everr.dev",
		"http://localhost:5173/everr//": "http://localhost:5173/everr",
		"http://127.0.0.1:8080":         "http://127.0.0.1:8080",
		"https://example.test/a/b/":     "https://example.test/a/b",
	} {
		if got, err := NormalizeURL(in); err != nil || got != want {
			t.Errorf("NormalizeURL(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{
		"app.everr.dev", "ftp://example.test", "https://user:pw@example.test",
		"https://example.test/?a=1", "https://example.test/?", "https://example.test/#x", "https://",
	} {
		if got, err := NormalizeURL(in); err == nil {
			t.Errorf("NormalizeURL(%q) = %q, want an error", in, got)
		}
	}
}

func isolateConfig(t *testing.T) *session.Store {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("EVERR_CONFIG_DIR", dir)
	for _, key := range []string{"EVERR_API_KEY", "EVERR_API_TOKEN", "EVERR_API_URL"} {
		t.Setenv(key, "")
		os.Unsetenv(key)
	}
	return session.At(dir)
}

// Covers the CLI test apply_uses_an_explicit_api_key_url_without_a_saved_session
// at the client level until `everr apply` is ported.
func TestAPIKeyWithExplicitURLNeedsNoSavedSession(t *testing.T) {
	store := isolateConfig(t)
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/apply" {
			t.Errorf("unexpected request %s", r.URL.Path)
		}
		auth = r.Header.Get("Authorization")
		io.WriteString(w, `{"dryRun":true,"results":[],"organization":{"id":"org-test","name":"Test"}}`)
	}))
	defer srv.Close()
	t.Setenv("EVERR_API_KEY", "api-key")
	t.Setenv("EVERR_API_URL", srv.URL+"/")

	client, err := NewClient(true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Apply(t.Context(), &api.ApplyRequest{Repoid: "test-repo", DryRun: true}); err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer api-key" {
		t.Errorf("Authorization = %q", auth)
	}
	if _, err := os.Stat(store.Path()); !os.IsNotExist(err) {
		t.Errorf("session file was created: %v", err)
	}
}

func TestAPIKeyFallsBackToTheSavedSessionURL(t *testing.T) {
	store := isolateConfig(t)
	if err := store.Save(session.Session{APIBaseURL: "https://example.test/everr", Token: "saved-token"}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EVERR_API_TOKEN", "legacy-key")

	client, err := NewClient(true)
	if err != nil {
		t.Fatal(err)
	}
	if client.BaseURL() != "https://example.test/everr" || client.AuthKind() != api.AuthToken {
		t.Errorf("client targets %s with kind %v", client.BaseURL(), client.AuthKind())
	}

	// Commands other than apply ignore the key and use the session.
	client, err = NewClient(false)
	if err != nil {
		t.Fatal(err)
	}
	if client.AuthKind() != api.AuthSession {
		t.Errorf("kind = %v, want session", client.AuthKind())
	}
}

func TestAPIKeyWithoutAnyTargetURLExplainsHowToSetOne(t *testing.T) {
	isolateConfig(t)
	t.Setenv("EVERR_API_KEY", "api-key")
	_, err := NewClient(true)
	if err == nil || err.Error() != "EVERR_API_KEY is set but no target URL is configured; set EVERR_API_URL or run `everr cloud login`." {
		t.Fatalf("err = %v", err)
	}
}

func TestClientWithoutSessionAsksToLogIn(t *testing.T) {
	isolateConfig(t)
	t.Setenv("EVERR_API_KEY", "api-key")
	_, err := NewClient(false)
	if err == nil || err.Error() != "No active session. Run `everr cloud login`." {
		t.Fatalf("err = %v", err)
	}
}
