package e2e

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// sourceSkill reads a file from the repository's skills/ directory, which is
// what the binary bundles.
func sourceSkill(t *testing.T, relative string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "skills", filepath.FromSlash(relative)))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func writeText(t *testing.T, p, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func assertIsFile(t *testing.T, paths ...string) {
	t.Helper()
	for _, p := range paths {
		if info, err := os.Stat(p); err != nil || !info.Mode().IsRegular() {
			t.Errorf("%s should be a file", p)
		}
	}
}

func assertIsSymlink(t *testing.T, p string) {
	t.Helper()
	info, err := os.Lstat(p)
	if err != nil || info.Mode()&fs.ModeSymlink == 0 {
		t.Errorf("%s should be a symlink", p)
	}
}

func (e *Env) repoDir(t *testing.T) string {
	t.Helper()
	repo := filepath.Join(e.HomeDir, "repo")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	return repo
}

func (e *Env) runIn(t *testing.T, dir string, args ...string) Result {
	t.Helper()
	cmd := e.Command(args...)
	cmd.Dir = dir
	return RunCmd(t, cmd)
}

func TestSkillsSubcommandHelpKeepsClapLayout(t *testing.T) {
	env := NewEnv(t)
	assertContains(t, env.Run("skills", "install", "--help").Success(t).Stdout,
		"Usage: everr skills install [OPTIONS]",
		"      --project        Use project-local .agents/skills in the current directory",
		"      --agent <AGENT>  Agent to install for [possible values: all, codex, claude-code, cursor]",
	)
	assertContains(t, env.Run("skills", "uninstall", "--help").Success(t).Stdout,
		"Usage: everr skills uninstall [OPTIONS] [SKILLS]...",
		"-y, --yes",
	)
}

func TestSkillsInstallAllProjectCreatesCanonicalSkillsAndProviderSymlink(t *testing.T) {
	env := NewEnv(t)
	repo := env.repoDir(t)

	out := env.runIn(t, repo, "skills", "install", "--all", "--project", "--agent", "claude-code").Success(t).Stdout

	assertContains(t, out, "Installed", "everr-setup-resources", "everr-setup-telemetry", "everr-use-telemetry")
	skills := filepath.Join(repo, ".agents", "skills")
	assertIsFile(t,
		filepath.Join(skills, "everr-setup-resources", "SKILL.md"),
		filepath.Join(skills, "everr-setup-telemetry", "rules", "nodejs.md"),
		filepath.Join(skills, "everr-setup-telemetry", "rules", "error-tracking.md"),
		filepath.Join(skills, "everr-setup-telemetry", "rules", "rust.md"),
	)
	assertIsSymlink(t, filepath.Join(repo, ".claude", "skills", "everr-setup-resources"))
}

func TestSkillsInstallAllProjectRestoresMissingTelemetryRules(t *testing.T) {
	env := NewEnv(t)
	repo := env.repoDir(t)
	install := []string{"skills", "install", "--all", "--project", "--agent", "claude-code"}
	env.runIn(t, repo, install...).Success(t)
	rules := filepath.Join(repo, ".agents", "skills", "everr-setup-telemetry", "rules")
	if err := os.RemoveAll(rules); err != nil {
		t.Fatal(err)
	}

	assertContains(t, env.runIn(t, repo, install...).Success(t).Stdout, "Installed")

	assertIsFile(t,
		filepath.Join(rules, "nodejs.md"),
		filepath.Join(rules, "error-tracking.md"),
		filepath.Join(rules, "rust.md"),
	)
}

func TestSkillsInstallWithoutSelectionRequiresInteractiveTerminal(t *testing.T) {
	res := NewEnv(t).Run("skills", "install").Failure(t, 1)
	assertContains(t, res.Stderr, "use --all")
}

func TestSkillsInstallRejectsNamedSkills(t *testing.T) {
	res := NewEnv(t).Run("skills", "install", "everr-use-telemetry", "--global").Failure(t, 2)
	assertContains(t, res.Stderr, "unexpected argument")
}

func TestSkillsScopeFlagsConflict(t *testing.T) {
	res := NewEnv(t).Run("skills", "list", "--project", "--global").Failure(t, 2)
	assertContains(t, res.Stderr, "cannot be used with")
}

func TestSkillsListShowsBundledSkills(t *testing.T) {
	out := NewEnv(t).Run("skills", "list", "--global", "--agent", "cursor").Success(t).Stdout
	assertContains(t, out, "bundled Everr skill(s) for global scope (Cursor):", "- everr-use-telemetry - ")
}

func TestSkillsInstallGlobalCreatesProviderSymlink(t *testing.T) {
	env := NewEnv(t)

	out := env.Run("skills", "install", "--all", "--global", "--agent", "codex").Success(t).Stdout

	assertContains(t, out, "Installed", "everr-use-telemetry")
	assertIsFile(t, filepath.Join(env.HomeDir, ".agents", "skills", "everr-use-telemetry", "SKILL.md"))
	codexSkill := filepath.Join(env.HomeDir, ".codex", "skills", "everr-use-telemetry")
	assertIsFile(t, filepath.Join(codexSkill, "SKILL.md"))
	assertIsSymlink(t, codexSkill)
}

func TestSkillsUpdateWithoutScopeRefreshesGlobalSkills(t *testing.T) {
	env := NewEnv(t)
	env.Run("skills", "install", "--all", "--global", "--agent", "codex").Success(t)
	skills := filepath.Join(env.HomeDir, ".agents", "skills")
	skillDoc := filepath.Join(skills, "everr-use-telemetry", "SKILL.md")
	rule := filepath.Join(skills, "everr-setup-telemetry", "rules", "validation.md")
	writeText(t, skillDoc, "local edits")
	writeText(t, rule, "stale rule")

	out := env.runIn(t, env.repoDir(t), "skills", "update").Success(t).Stdout

	assertContains(t, out, "Updated", "everr-use-telemetry", "everr-setup-telemetry")
	if got := string(readFile(t, skillDoc)); got != sourceSkill(t, "everr-use-telemetry/SKILL.md") {
		t.Errorf("skill was not updated:\n%s", got)
	}
	if got := string(readFile(t, rule)); got != sourceSkill(t, "everr-setup-telemetry/rules/validation.md") {
		t.Errorf("rule was not refreshed:\n%s", got)
	}
}

func TestSkillsUpdateReplacesLegacyGlobalSkillNames(t *testing.T) {
	env := NewEnv(t)
	legacySkill := filepath.Join(env.HomeDir, ".agents", "skills", "everr-local-debugging", "SKILL.md")
	writeText(t, legacySkill, "name: everr-local-debugging")

	out := env.Run("skills", "update").Success(t).Stdout

	assertContains(t, out, "Updated 1 skill: everr-use-telemetry")
	if _, err := os.Lstat(legacySkill); err == nil {
		t.Errorf("%s should be removed", legacySkill)
	}
	assertIsFile(t, filepath.Join(env.HomeDir, ".agents", "skills", "everr-use-telemetry", "SKILL.md"))
}

func TestSkillsUpdateWithNothingInstalledFails(t *testing.T) {
	res := NewEnv(t).Run("skills", "update").Failure(t, 1)
	assertContains(t, res.Stderr, "no installed bundled Everr skills found in project or global scope")
}

func TestSkillsUninstallAllRequiresYes(t *testing.T) {
	env := NewEnv(t)
	env.Run("skills", "install", "--all", "--global").Success(t)

	res := env.Run("skills", "uninstall", "--all", "--global").Failure(t, 1)
	assertContains(t, res.Stderr, "without --yes")

	out := env.Run("skills", "uninstall", "--all", "--global", "--yes").Success(t).Stdout
	assertContains(t, out, "Uninstalled", "everr-use-telemetry removed")
	for _, dir := range []string{".agents", ".codex", ".claude", ".cursor"} {
		p := filepath.Join(env.HomeDir, dir, "skills", "everr-use-telemetry")
		if _, err := os.Lstat(p); err == nil {
			t.Errorf("%s should be removed", p)
		}
	}
}
