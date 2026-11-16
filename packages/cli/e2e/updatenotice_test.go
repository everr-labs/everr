package e2e

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	everrcli "github.com/everr-labs/everr/packages/cli"
)

const updateNotice = "A new version is available"

func writeUpdateCache(t *testing.T, env *Env, latestVersion string, updateAvailable bool, lastCheckedAt string) {
	t.Helper()
	body, err := json.MarshalIndent(map[string]any{
		"last_checked_at":  lastCheckedAt,
		"latest_version":   latestVersion,
		"update_available": updateAvailable,
	}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(env.UpdateCachePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(env.UpdateCachePath(), body, 0o644); err != nil {
		t.Fatal(err)
	}
}

// releaseMetadataServer serves release metadata for version and counts
// requests.
func releaseMetadataServer(t *testing.T, version string) (url string, requests *atomic.Int32) {
	t.Helper()
	requests = &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/everr-app/release-metadata.json" || r.URL.RawQuery != "" {
			http.NotFound(w, r)
			return
		}
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"version": version})
	}))
	t.Cleanup(server.Close)
	return server.URL + "/everr-app/release-metadata.json", requests
}

func TestCachedUpdatePrintsNoticeWithoutNetwork(t *testing.T) {
	env := NewEnv(t)
	writeUpdateCache(t, env, "2099.1.0", true, "2099-01-01T00:00:00Z")
	out := env.Run("skills", "list").Success(t).Stdout
	assertContains(t, out, "A new version is available: 2099.1.0", "Run: everr upgrade")
}

func TestStaleCacheFetchesReleaseMetadataAndRecordsUpdate(t *testing.T) {
	env := NewEnv(t)
	writeUpdateCache(t, env, "0.0.1", false, "2000-01-01T00:00:00Z")
	url, requests := releaseMetadataServer(t, "2099.1.0")

	out := env.WithReleaseMetadataURL(url).Run("skills", "list").Success(t).Stdout
	assertContains(t, out, "A new version is available: 2099.1.0", "Run: everr upgrade")
	if got := requests.Load(); got != 1 {
		t.Fatalf("metadata requests = %d, want 1", got)
	}

	body, err := os.ReadFile(env.UpdateCachePath())
	if err != nil {
		t.Fatal(err)
	}
	var cache map[string]any
	if err := json.Unmarshal(body, &cache); err != nil {
		t.Fatal(err)
	}
	if cache["latest_version"] != "2099.1.0" || cache["update_available"] != true {
		t.Fatalf("cache = %s", body)
	}
}

func TestCachedCurrentVersionDoesNotPrintNotice(t *testing.T) {
	env := NewEnv(t)
	writeUpdateCache(t, env, everrcli.Version, true, "2099-01-01T00:00:00Z")
	assertNotContains(t, env.Run("skills", "list").Success(t).Stdout, updateNotice)
}

func TestWrapStdoutIsNotPrefixedByUpdateNotice(t *testing.T) {
	env := NewEnv(t).Setenv("EVERR_OTLP_HTTP_ORIGIN", "http://127.0.0.1:9")
	writeUpdateCache(t, env, "2099.1.0", true, "2099-01-01T00:00:00Z")
	if out := env.Run("wrap", "--", "sh", "-c", "printf 'child stdout\\n'").Failure(t, 2).Stdout; out != "" {
		t.Fatalf("stdout = %q", out)
	}
}

func TestVersionFlagRemainsAvailableWithoutNotice(t *testing.T) {
	env := NewEnv(t)
	writeUpdateCache(t, env, "2099.1.0", true, "2099-01-01T00:00:00Z")
	out := env.Run("--version").Success(t).Stdout
	assertContains(t, out, "everr")
	assertNotContains(t, out, updateNotice)
}
