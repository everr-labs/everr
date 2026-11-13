package e2e

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

const resourceList = `[{"kind":"dashboard","project":"default","slug":"cpu","repoid":"github.com/acme/api","updatedAt":"2026-07-01"},` +
	`{"kind":"runbook","project":"default","slug":"oom","repoid":"","updatedAt":"2026-07-02"}]`

func TestResourcesListStarsThisRepositorysResources(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"GET /api/cli/resources": {Body: resourceList}})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")
	cmd := env.Command("resources", "list")
	cmd.Dir = env.InitGitRepo("repo", "main", "https://github.com/acme/api.git")

	res := RunCmd(t, cmd).Success(t)
	want := "KIND        PROJECT     SLUG                          REPOID                    UPDATED\n" +
		"*dashboard  default     cpu                           github.com/acme/api       2026-07-01\n" +
		" runbook    default     oom                           (ui)                      2026-07-02\n" +
		"\n* owned by this repository\n"
	if res.Stdout != want {
		t.Errorf("stdout:\n%s\nwant:\n%s", res.Stdout, want)
	}
	srv.expect(t, "GET /api/cli/resources", 1, "token")
}

func TestResourcesListSendsFiltersAndPrintsJSON(t *testing.T) {
	queries := make(chan string, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries <- r.URL.RawQuery
		io.WriteString(w, "[]")
	}))
	t.Cleanup(srv.Close)
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")

	res := env.Run("resources", "list", "--kind", "runbook", "--repoid", "github.com/acme/api", "--json").Success(t)
	if res.Stdout != "[]\n" {
		t.Errorf("stdout = %q", res.Stdout)
	}
	if got := <-queries; got != "kind=runbook&repoid=github.com%2Facme%2Fapi" {
		t.Errorf("query = %q", got)
	}
	assertContains(t, env.Run("resources", "list").Success(t).Stdout, "No resources.")
	if got := <-queries; got != "" {
		t.Errorf("unfiltered query = %q", got)
	}
}

func TestResourcesShowPrintsYAMLOrJSON(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"GET /api/cli/resources/dashboard/team/cpu": {
		Body: `{"kind":"Dashboard","metadata":{"name":"cpu"}}`,
	}})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")

	yamlOut := env.Run("resources", "show", "dashboard", "cpu", "--project", "team").Success(t).Stdout
	if yamlOut != "kind: Dashboard\nmetadata:\n  name: cpu\n" {
		t.Errorf("yaml = %q", yamlOut)
	}
	jsonOut := env.Run("resources", "show", "dashboard", "cpu", "--project", "team", "--json").Success(t).Stdout
	if jsonOut != "{\n  \"kind\": \"Dashboard\",\n  \"metadata\": {\n    \"name\": \"cpu\"\n  }\n}\n" {
		t.Errorf("json = %q", jsonOut)
	}
}

func TestResourcesDeleteRemovesTheResource(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"DELETE /api/cli/resources/alert/default/high-errors": {}})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")

	res := env.Run("resources", "delete", "alert", "high-errors").Success(t)
	assertContains(t, res.Stdout, "Deleted alert/default/high-errors.", "the next `everr apply` will recreate it")
	assertContains(t, res.Stderr, "Target: "+srv.URL)
	srv.expect(t, "DELETE /api/cli/resources/alert/default/high-errors", 1, "token")
}

func TestResourcesAdoptNeedsConfirmationWhenNotInteractive(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")
	cmd := env.Command("resources", "adopt", "runbook", "oom")
	cmd.Dir = env.InitGitRepo("repo", "main", "https://github.com/acme/api.git")

	res := RunCmd(t, cmd).Failure(t, 1)
	assertContains(t, res.Stderr, "refusing to proceed without confirmation; re-run with --yes")
}

func TestResourcesAdoptMovesOwnershipToThisRepository(t *testing.T) {
	for _, tc := range []struct {
		alreadyOwned string
		message      string
	}{
		{"false", "Adopted runbook/default/oom into «github.com/acme/api»."},
		{"true", "runbook/default/oom is already owned by «github.com/acme/api». Nothing to do."},
	} {
		srv := newCloudServer(t, map[string]reply{"POST /api/cli/resources/runbook/default/oom/adopt": {
			Body: `{"kind":"runbook","project":"default","slug":"oom","repoid":"github.com/acme/api","alreadyOwned":` + tc.alreadyOwned + `}`,
		}})
		env := NewEnv(t)
		env.WriteSession(srv.URL, "token")
		cmd := env.Command("resources", "adopt", "runbook", "oom", "--yes")
		cmd.Dir = env.InitGitRepo("repo", "main", "https://github.com/acme/api.git")

		assertContains(t, RunCmd(t, cmd).Success(t).Stdout, tc.message)
		srv.expect(t, "POST /api/cli/resources/runbook/default/oom/adopt", 1, "token")
		if body := srv.requests("POST /api/cli/resources/runbook/default/oom/adopt")[0].Body; body != `{"repoid":"github.com/acme/api"}` {
			t.Errorf("adopt body = %s", body)
		}
	}
}

func TestResourcesCommandsRequireASession(t *testing.T) {
	res := NewEnv(t).Run("resources", "list").Failure(t, 1)
	assertContains(t, res.Stderr, "No active session. Run `everr cloud login`.")
}

// The resources half of remote_commands_use_the_saved_api_url_including_its_path_prefix.
func TestResourcesUseTheSavedURLIncludingItsPathPrefix(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"GET /everr/api/cli/resources": {Body: "[]"}})
	other := newCloudServer(t, map[string]reply{})
	env := NewEnv(t).WithAPIBaseURL(other.URL)
	env.WriteSession(srv.URL+"/everr", "saved-token")

	env.Run("resources", "list").Success(t)
	srv.expect(t, "GET /everr/api/cli/resources", 1, "saved-token")
}
