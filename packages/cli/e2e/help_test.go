package e2e

import (
	"strings"
	"testing"
)

func assertContains(t *testing.T, got string, wants ...string) {
	t.Helper()
	for _, want := range wants {
		if !strings.Contains(got, want) {
			t.Errorf("output does not contain %q:\n%s", want, got)
		}
	}
}

func assertNotContains(t *testing.T, got string, unwanted ...string) {
	t.Helper()
	for _, s := range unwanted {
		if strings.Contains(got, s) {
			t.Errorf("output contains %q:\n%s", s, got)
		}
	}
}

func TestRootHelpListsMainCommands(t *testing.T) {
	out := NewEnv(t).Run("--help").Success(t).Stdout
	assertContains(t, out,
		"Query telemetry, inspect CI, and manage resources as code in Everr",
		"Usage: everr <COMMAND>",
		"cloud", "local", "wrap", "skills", "upgrade", "apply", "resources",
		"Authenticate with and query a remote Everr installation",
		"Run and query the local telemetry Collector",
		"Reconcile a directory of as-code resources",
	)
	assertNotContains(t, out,
		"\n  install", "\n  login", "\n  logout", "\n  profiles", "--profile",
		"setup-assistant", "\n  setup", "\n  init", "ai-instructions", "\n  status",
		"\n  grep", "slowest-tests", "slowest-jobs", "\n  watch", "wait-pipeline",
		"\n  runs", "\n  show", "\n  logs", "\n  ci", "completion",
	)
}

func TestVersionNamesBuildType(t *testing.T) {
	out := NewEnv(t).Run("--version").Success(t).Stdout
	assertContains(t, out, "everr", "debug build")
}

func TestRemovedCommandsAreRejected(t *testing.T) {
	env := NewEnv(t)
	for _, args := range [][]string{
		{"cloud", "logs", "--help"}, {"ci"}, {"ci", "status"}, {"setup-assistant"},
		{"ai-instructions"}, {"wait-pipeline"}, {"status"}, {"grep"}, {"watch"},
		{"runs"}, {"show"}, {"logs"}, {"telemetry"}, {"test-history"},
		{"slowest-tests"}, {"slowest-jobs"}, {"workflows"}, {"setup"}, {"init"},
		{"query"}, {"login"}, {"logout"}, {"whoami"},
	} {
		res := env.Run(args...).Failure(t, 2)
		assertContains(t, res.Stderr, "unrecognized subcommand")
	}
}
