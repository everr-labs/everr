package skills

import (
	"bytes"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func newOptions(t *testing.T, scope Scope, providers []Provider, names ...string) Options {
	t.Helper()
	return Options{
		Scope:      scope,
		Cwd:        t.TempDir(),
		HomeDir:    t.TempDir(),
		Providers:  providers,
		SkillNames: names,
		All:        len(names) == 0,
	}
}

func mustInstall(t *testing.T, options Options) Summary {
	t.Helper()
	summary, err := Install(options)
	if err != nil {
		t.Fatal(err)
	}
	return summary
}

func assertSymlinkTo(t *testing.T, link, target string) {
	t.Helper()
	info, err := os.Lstat(link)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&fs.ModeSymlink == 0 {
		t.Fatalf("%s should be a symlink", link)
	}
	resolved, err := filepath.EvalSymlinks(link)
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.EvalSymlinks(target)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != want {
		t.Fatalf("%s points to %s, want %s", link, resolved, want)
	}
}

func assertMissing(t *testing.T, paths ...string) {
	t.Helper()
	for _, p := range paths {
		// Lstat does not follow links, so a dangling symlink counts as present.
		if _, err := os.Lstat(p); err == nil {
			t.Errorf("%s should not exist", p)
		}
	}
}

func assertFile(t *testing.T, p string) {
	t.Helper()
	if info, err := os.Stat(p); err != nil || !info.Mode().IsRegular() {
		t.Errorf("%s should be a file", p)
	}
}

func readFile(t *testing.T, p string) string {
	t.Helper()
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func bundledFile(t *testing.T, p string) []byte {
	t.Helper()
	fsys, err := bundle()
	if err != nil {
		t.Fatal(err)
	}
	data, err := fs.ReadFile(fsys, p)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func writeFile(t *testing.T, p, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestInstallsAllBundledSkillsAndSupportingFiles(t *testing.T) {
	options := newOptions(t, ScopeProject, []Provider{Codex})
	mustInstall(t, options)

	fsys, err := bundle()
	if err != nil {
		t.Fatal(err)
	}
	bundled := map[string][]byte{}
	skills, _ := Bundled()
	for _, skill := range skills {
		files, err := bundledFileMap(fsys, skill.Name)
		if err != nil {
			t.Fatal(err)
		}
		for p, contents := range files {
			bundled[skill.Name+"/"+p] = contents
		}
	}
	installed, err := fileMap(filepath.Join(options.Cwd, ".agents", "skills"))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := slices.Sorted(maps.Keys(installed)), slices.Sorted(maps.Keys(bundled)); !slices.Equal(got, want) {
		t.Fatalf("installed files = %v, want %v", got, want)
	}
	for p, contents := range bundled {
		if !bytes.Equal(installed[p], contents) {
			t.Errorf("installed %s differs from the bundle", p)
		}
	}
}

func TestInstallOverwritesModifiedRule(t *testing.T) {
	options := newOptions(t, ScopeProject, []Provider{Codex}, "everr-setup-telemetry")
	skillDir := filepath.Join(options.Cwd, ".agents", "skills", "everr-setup-telemetry")
	writeFile(t, filepath.Join(skillDir, "SKILL.md"), string(bundledFile(t, "everr-setup-telemetry/SKILL.md")))
	rule := filepath.Join(skillDir, "rules", "error-tracking.md")
	writeFile(t, rule, "local edits")

	mustInstall(t, options)

	if got := readFile(t, rule); got != string(bundledFile(t, "everr-setup-telemetry/rules/error-tracking.md")) {
		t.Fatalf("rule was not replaced:\n%s", got)
	}
}

func TestInstallsProjectSkillsToCanonicalAgentsDirAndSymlinksClaude(t *testing.T) {
	options := newOptions(t, ScopeProject, AllProviders, "everr-use-telemetry")
	mustInstall(t, options)

	canonical := filepath.Join(options.Cwd, ".agents", "skills", "everr-use-telemetry")
	assertFile(t, filepath.Join(canonical, "SKILL.md"))
	assertMissing(t,
		filepath.Join(options.Cwd, ".codex", "skills", "everr-use-telemetry"),
		filepath.Join(options.Cwd, ".cursor", "skills", "everr-use-telemetry"),
	)
	assertSymlinkTo(t, filepath.Join(options.Cwd, ".claude", "skills", "everr-use-telemetry"), canonical)
}

func TestInstallsGlobalSkillsToAgentsDirAndSymlinksProviders(t *testing.T) {
	options := newOptions(t, ScopeGlobal, AllProviders, "everr-use-telemetry")
	mustInstall(t, options)

	canonical := filepath.Join(options.HomeDir, ".agents", "skills", "everr-use-telemetry")
	assertFile(t, filepath.Join(canonical, "SKILL.md"))
	for _, dir := range []string{".codex", ".claude", ".cursor"} {
		assertSymlinkTo(t, filepath.Join(options.HomeDir, dir, "skills", "everr-use-telemetry"), canonical)
	}
}

func TestUninstallGlobalSkillsRemovesProviderSymlinks(t *testing.T) {
	options := newOptions(t, ScopeGlobal, AllProviders, "everr-use-telemetry")
	mustInstall(t, options)
	if _, err := Uninstall(options); err != nil {
		t.Fatal(err)
	}

	// Provider links resolve to the canonical dir; uninstall must remove them
	// rather than leave them dangling.
	for _, dir := range []string{".agents", ".codex", ".claude", ".cursor"} {
		assertMissing(t, filepath.Join(options.HomeDir, dir, "skills", "everr-use-telemetry"))
	}
}

func TestDryRunReportsChangesWithoutWritingFiles(t *testing.T) {
	options := newOptions(t, ScopeGlobal, []Provider{Codex}, "everr-use-telemetry")
	options.DryRun = true

	summary := mustInstall(t, options)

	if !summary.DryRun {
		t.Error("summary should be a dry run")
	}
	hasAction := func(action PathAction) bool {
		return slices.ContainsFunc(summary.Changes, func(c PathChange) bool { return c.Action == action })
	}
	if !hasAction(WouldWrite) || !hasAction(WouldLink) {
		t.Errorf("changes = %+v, want would-write and would-link", summary.Changes)
	}
	assertMissing(t,
		filepath.Join(options.HomeDir, ".agents", "skills", "everr-use-telemetry"),
		filepath.Join(options.HomeDir, ".codex", "skills", "everr-use-telemetry"),
	)
}

func TestUpdateReplacesInstalledLegacySkillWithSuccessor(t *testing.T) {
	const legacy, successor = "everr-ci-debugging", "everr-working-with-ci"
	options := newOptions(t, ScopeProject, []Provider{ClaudeCode})
	options.All = false
	legacyCanonical := filepath.Join(options.Cwd, ".agents", "skills", legacy)
	writeFile(t, filepath.Join(legacyCanonical, "SKILL.md"), "name: "+legacy)
	legacyProvider := filepath.Join(options.Cwd, ".claude", "skills", legacy)
	if err := os.MkdirAll(filepath.Dir(legacyProvider), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(legacyCanonical, legacyProvider); err != nil {
		t.Fatal(err)
	}

	names, err := InstalledUpdateSkillNames(options)
	if err != nil {
		t.Fatal(err)
	}
	options.SkillNames = names
	summary, err := Update(options)
	if err != nil {
		t.Fatal(err)
	}

	if !slices.Equal(summary.Skills, []string{successor}) {
		t.Errorf("updated skills = %v, want [%s]", summary.Skills, successor)
	}
	assertMissing(t, legacyCanonical, legacyProvider)
	canonical := filepath.Join(options.Cwd, ".agents", "skills", successor)
	if got := readFile(t, filepath.Join(canonical, "SKILL.md")); !strings.Contains(got, "name: "+successor) {
		t.Errorf("successor SKILL.md does not name %s:\n%s", successor, got)
	}
	assertSymlinkTo(t, filepath.Join(options.Cwd, ".claude", "skills", successor), canonical)
}

func TestInstallReplacesStaleProviderSymlink(t *testing.T) {
	for name, target := range map[string]func(t *testing.T, home string) string{
		"other directory": func(t *testing.T, _ string) string { return t.TempDir() },
		"dangling":        func(_ *testing.T, home string) string { return filepath.Join(home, "missing-target") },
	} {
		t.Run(name, func(t *testing.T) {
			options := newOptions(t, ScopeGlobal, []Provider{ClaudeCode}, "everr-use-telemetry")
			providerLink := filepath.Join(options.HomeDir, ".claude", "skills", "everr-use-telemetry")
			if err := os.MkdirAll(filepath.Dir(providerLink), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(target(t, options.HomeDir), providerLink); err != nil {
				t.Fatal(err)
			}

			mustInstall(t, options)

			assertSymlinkTo(t, providerLink, filepath.Join(options.HomeDir, ".agents", "skills", "everr-use-telemetry"))
		})
	}
}

func TestParseSkillFrontmatter(t *testing.T) {
	name, description, err := parseSkillFrontmatter("---\r\nname: demo\r\ndescription: Use when: things\r\n---\r\nbody")
	if err != nil {
		t.Fatal(err)
	}
	if name != "demo" || description != "Use when: things" {
		t.Errorf("got name %q, description %q", name, description)
	}
	for _, content := range []string{"no frontmatter", "---\nname: demo\n---\n", "---\nname: demo\ndescription: x\n"} {
		if _, _, err := parseSkillFrontmatter(content); err == nil {
			t.Errorf("parseSkillFrontmatter(%q) should fail", content)
		}
	}
}

func TestSkillNamesMustNotEscapeTheSkillsDir(t *testing.T) {
	for _, name := range []string{"..", "../evil", `a\b`} {
		options := newOptions(t, ScopeProject, nil, name)
		if _, err := Install(options); err == nil {
			t.Errorf("Install(%q) should fail", name)
		}
	}
}
