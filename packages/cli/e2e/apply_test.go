package e2e

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const applyPlan = `{"dryRun":true,"results":[{"kind":"Dashboard","created":["cpu"],"updated":[],"deleted":["old"]}],` +
	`"organization":{"id":"org-1","name":"Acme"}}`

// resourceDir writes a pinned repoid and one dashboard under HomeDir.
func resourceDir(t *testing.T, env *Env) string {
	t.Helper()
	dir := filepath.Join(env.HomeDir, "resources")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, contents := range map[string]string{
		"everr.yaml": "repoid: test-repo\n",
		"cpu.yaml":   "kind: Dashboard\nmetadata:\n  name: cpu\nspec:\n  panels: {}\n  layouts: []\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func applyRequests(t *testing.T, srv *cloudServer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, r := range srv.requests("POST /api/apply") {
		var body map[string]any
		if err := json.Unmarshal([]byte(r.Body), &body); err != nil {
			t.Fatal(err)
		}
		out = append(out, body)
	}
	return out
}

func TestApplyHelpDescribesReconciliation(t *testing.T) {
	out := NewEnv(t).Run("apply", "--help").Success(t).Stdout
	assertContains(t, out, "Reconcile a directory of as-code resources with Everr", "--preview [<NAME>]", "--dry-run", "--adopt")
}

func TestApplyDryRunPrintsThePlanWithoutApplying(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"POST /api/apply": {Body: applyPlan}})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")
	cmd := env.Command("apply", ".", "--dry-run")
	cmd.Dir = resourceDir(t, env)

	res := RunCmd(t, cmd).Success(t)
	want := "Repoid: test-repo (everr.yaml)\n(plan) Destination org: «Acme»\n" +
		"(plan) Dashboard: 1 created, 0 updated, 1 deleted\n  + cpu\n  - old\n"
	if res.Stdout != want {
		t.Errorf("stdout:\n%s\nwant:\n%s", res.Stdout, want)
	}
	assertContains(t, res.Stderr, "Target: "+srv.URL)
	srv.expect(t, "POST /api/apply", 1, "token")
	body := applyRequests(t, srv)[0]
	if body["repoid"] != "test-repo" || body["dryRun"] != true {
		t.Errorf("request = %v", body)
	}
	dashboards := body["state"].(map[string]any)["dashboards"].([]any)
	if len(dashboards) != 1 || dashboards[0].(map[string]any)["path"] != "cpu.yaml" {
		t.Errorf("dashboards = %v", dashboards)
	}
}

func TestLiveApplyRefusesWithoutConfirmationWhenNotInteractive(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"POST /api/apply": {Body: applyPlan}})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")
	cmd := env.Command("apply", ".")
	cmd.Dir = resourceDir(t, env)

	res := RunCmd(t, cmd).Failure(t, 1)
	assertContains(t, res.Stderr, "refusing to apply to Acme without confirmation; re-run with --yes")
	srv.expect(t, "POST /api/apply", 1, "token")
}

func TestApplyWithYesPlansThenApplies(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"POST /api/apply": {Body: applyPlan}})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")
	cmd := env.Command("apply", ".", "--yes", "--adopt")
	cmd.Dir = resourceDir(t, env)

	res := RunCmd(t, cmd).Success(t)
	assertContains(t, res.Stdout, "(plan) Destination org: «Acme»", "\nDestination org: «Acme»")
	requests := applyRequests(t, srv)
	if len(requests) != 2 || requests[0]["dryRun"] != true || requests[1]["dryRun"] != false || requests[1]["adopt"] != true {
		t.Errorf("requests = %v", requests)
	}
}

func TestApplyWithoutChangesHasNothingToApply(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"POST /api/apply": {
		Body: `{"dryRun":true,"results":[],"organization":{"id":"org-1","name":"Acme"}}`,
	}})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")
	cmd := env.Command("apply", ".")
	cmd.Dir = resourceDir(t, env)

	assertContains(t, RunCmd(t, cmd).Success(t).Stdout, "Nothing to apply.")
	srv.expect(t, "POST /api/apply", 1, "token")
}

func TestPreviewApplySkipsConfirmationAndLinksThePreview(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"POST /api/apply": {Body: applyPlan}})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")
	cmd := env.Command("apply", ".", "--preview", "gio/x")
	cmd.Dir = resourceDir(t, env)

	res := RunCmd(t, cmd).Success(t)
	assertContains(t, res.Stdout, "Preview: "+srv.URL+"/dashboards?preview=gio%2Fx\n")
	for _, body := range applyRequests(t, srv) {
		if body["preview"] != "gio/x" {
			t.Errorf("request preview = %v", body["preview"])
		}
	}
}

func TestApplyInfersTheRepoidFromTheOriginRemote(t *testing.T) {
	srv := newCloudServer(t, map[string]reply{"POST /api/apply": {Body: applyPlan}})
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token")
	repo := env.InitGitRepo("repo", "main", "git@github.com:Acme/API.git")
	cmd := env.Command("apply", ".", "--dry-run")
	cmd.Dir = repo

	res := RunCmd(t, cmd).Success(t)
	assertContains(t, res.Stdout, "Repoid: github.com/acme/api (inferred from origin remote)")
	assertContains(t, res.Stderr, "warning: no resource files (.yaml/.yml/.json) found under .")
	source := applyRequests(t, srv)[0]["source"].(map[string]any)
	if source["branch"] != "main" || source["remote"] != "git@github.com:Acme/API.git" || source["commitSha"] == nil {
		t.Errorf("source = %v", source)
	}
}

func TestApplyFailsWithoutARepositoryIdentity(t *testing.T) {
	env := NewEnv(t)
	env.WriteSession("http://127.0.0.1:1", "token")
	res := env.Run("apply", ".").Failure(t, 1)
	assertContains(t, res.Stderr, "cannot determine the repository identity", "everr.yaml")
}

func TestApplyRejectsAMissingDirectory(t *testing.T) {
	env := NewEnv(t)
	env.WriteSession("http://127.0.0.1:1", "token")
	assertContains(t, env.Run("apply", "nope").Failure(t, 1).Stderr, "nope is not a directory")
}

// The apply half of remote_commands_use_the_saved_api_url_including_its_path_prefix.
func TestApplyUsesTheSavedURLIncludingItsPathPrefix(t *testing.T) {
	for _, apiKey := range []string{"", "api-key"} {
		srv := newCloudServer(t, map[string]reply{"POST /everr/api/apply": {
			Body: `{"dryRun":true,"results":[],"organization":{"id":"org-test","name":"Test"}}`,
		}})
		other := newCloudServer(t, map[string]reply{})
		env := NewEnv(t).WithAPIBaseURL(other.URL)
		env.WriteSession(srv.URL+"/everr", "saved-token")
		if apiKey != "" {
			env.Setenv("EVERR_API_KEY", apiKey)
		}
		cmd := env.Command("apply", ".", "--dry-run")
		cmd.Dir = resourceDir(t, env)

		RunCmd(t, cmd).Success(t)
		token := apiKey
		if token == "" {
			token = "saved-token"
		}
		srv.expect(t, "POST /everr/api/apply", 1, token)
	}
}
