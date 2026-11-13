package apply

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/everr-labs/everr/packages/cli/internal/api"
)

const dash = "kind: Dashboard\nmetadata:\n  name: d\nspec:\n  panels: {}\n  layouts: []\n"

func write(t *testing.T, dir, name, contents string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func load(t *testing.T, dir string) []ResourceDocument {
	t.Helper()
	docs, err := LoadResourceDocuments(dir)
	if err != nil {
		t.Fatal(err)
	}
	return docs
}

func paths(docs []ResourceDocument) []string {
	out := []string{}
	for _, doc := range docs {
		out = append(out, doc.Path)
	}
	return out
}

// asJSON compares documents the way they go over the wire.
func asJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestLoadsYAMLAndJSONWithRelativePOSIXPaths(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "team/cpu.yaml", "kind: Dashboard\nmetadata:\n  name: cpu\nspec:\n  panels: {}\n  layouts: []\n")
	write(t, dir, "mem.json", `{"kind":"Dashboard","metadata":{"name":"mem"},"spec":{"panels":{},"layouts":[]}}`)

	docs := load(t, dir)
	if got := paths(docs); !reflect.DeepEqual(got, []string{"mem.json", "team/cpu.yaml"}) {
		t.Fatalf("paths = %v", got)
	}
	if got := asJSON(t, docs[1].Document); got != `{"kind":"Dashboard","metadata":{"name":"cpu"},"spec":{"layouts":[],"panels":{}}}` {
		t.Errorf("document = %s", got)
	}
}

func TestYAMLKeepsTimestampsAndYAML11BooleansAsStrings(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "d.yaml", "kind: Dashboard\ndate: 2024-01-01\nflag: yes\ncount: 3\nratio: 0.5\nnothing: ~\n")
	got := asJSON(t, load(t, dir)[0].Document)
	if want := `{"count":3,"date":"2024-01-01","flag":"yes","kind":"Dashboard","nothing":null,"ratio":0.5}`; got != want {
		t.Errorf("document = %s, want %s", got, want)
	}
}

func TestYAMLKeepsLeadingZeroAndUnderscoreNumbersAsStrings(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "d.yaml", "kind: Dashboard\nzip: 01234\nzero: 000\nsep: 1_000\nhex: 0x1A\noct: 0o17\nneg: -5\n")
	got := asJSON(t, load(t, dir)[0].Document)
	if want := `{"hex":26,"kind":"Dashboard","neg":-5,"oct":15,"sep":"1_000","zero":"000","zip":"01234"}`; got != want {
		t.Errorf("document = %s, want %s", got, want)
	}
}

func TestRespectsGitignore(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, ".gitignore", "generated/\nscratch.yaml\n")
	write(t, dir, "cpu.yaml", dash)
	write(t, dir, "scratch.yaml", dash)
	write(t, dir, "generated/old.yaml", dash)
	write(t, dir, "nested/scratch.yaml", dash)
	if got := paths(load(t, dir)); !reflect.DeepEqual(got, []string{"cpu.yaml"}) {
		t.Errorf("paths = %v", got)
	}
}

func TestGitignoreRulesFromTheRepositoryRootApply(t *testing.T) {
	repo := t.TempDir()
	if err := os.Mkdir(filepath.Join(repo, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, repo, ".gitignore", "everr/tmp/\n*.local.yaml\n!keep.local.yaml\n")
	dir := filepath.Join(repo, "everr")
	write(t, dir, "cpu.yaml", dash)
	write(t, dir, "tmp/old.yaml", dash)
	write(t, dir, "mine.local.yaml", dash)
	write(t, dir, "keep.local.yaml", dash)
	if got := paths(load(t, dir)); !reflect.DeepEqual(got, []string{"cpu.yaml", "keep.local.yaml"}) {
		t.Errorf("paths = %v", got)
	}
}

func TestWorktreeUsesTheMainRepositoryExcludeFile(t *testing.T) {
	main := t.TempDir()
	write(t, main, ".git/info/exclude", "*.draft.yaml\n")
	write(t, main, ".git/worktrees/feature/commondir", "../..\n")
	worktree := t.TempDir()
	write(t, worktree, ".git", "gitdir: "+filepath.Join(main, ".git", "worktrees", "feature")+"\n")
	dir := filepath.Join(worktree, "everr")
	write(t, dir, "cpu.yaml", dash)
	write(t, dir, "wip.draft.yaml", dash)
	if got := paths(load(t, dir)); !reflect.DeepEqual(got, []string{"cpu.yaml"}) {
		t.Errorf("paths = %v", got)
	}
}

func TestSkipsHiddenFilesAndDirs(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "cpu.yaml", dash)
	write(t, dir, ".hidden.yaml", dash)
	write(t, dir, ".git/config.yaml", dash)
	if got := paths(load(t, dir)); !reflect.DeepEqual(got, []string{"cpu.yaml"}) {
		t.Errorf("paths = %v", got)
	}
}

func TestErrorsWithFilenameOnInvalidYAML(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "broken.yaml", "key: : :\n  - bad")
	if _, err := LoadResourceDocuments(dir); err == nil || !strings.Contains(err.Error(), "broken.yaml") {
		t.Errorf("err = %v", err)
	}
}

func TestManifest(t *testing.T) {
	for _, tc := range []struct {
		name  string
		files map[string]string
		want  string
	}{
		{"trims repoid", map[string]string{"everr.yaml": "repoid: \" abc-123 \"\n"}, "abc-123"},
		{"accepts everr.yml", map[string]string{"everr.yml": "repoid: \"abc\"\n"}, "abc"},
		{"prefers everr.yaml", map[string]string{"everr.yaml": "repoid: \"canonical\"\n", "everr.yml": "repoid: \"legacy\"\n"}, "canonical"},
		{"missing", map[string]string{}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			for name, contents := range tc.files {
				write(t, dir, name, contents)
			}
			got, err := LoadApplyManifest(dir)
			if err != nil || got != tc.want {
				t.Errorf("LoadApplyManifest = %q, %v; want %q", got, err, tc.want)
			}
		})
	}
}

func TestManifestRejectsEmptyRepoidAndExtraKeys(t *testing.T) {
	for _, contents := range []string{"repoid: \"\"\n", "repoid: \"x\"\nprojects: [a]\n", "other: 1\n", ""} {
		dir := t.TempDir()
		write(t, dir, "everr.yaml", contents)
		if _, err := LoadApplyManifest(dir); err == nil {
			t.Errorf("manifest %q was accepted", contents)
		}
	}
}

func TestLoadResourceDocumentsSkipsTheManifestAndNonResourceFiles(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "README.md", "# not a dashboard")
	write(t, dir, "everr.yaml", "repoid: abc\n")
	write(t, dir, "everr.yml", "repoid: legacy\n")
	write(t, dir, "cpu.yaml", dash)
	if got := paths(load(t, dir)); !reflect.DeepEqual(got, []string{"cpu.yaml"}) {
		t.Errorf("paths = %v", got)
	}
}

func doc(path, kind string) ResourceDocument {
	return ResourceDocument{Path: path, Document: map[string]any{"kind": kind}}
}

func TestClassifySplitsKindsAndAcceptsTheNotebookAlias(t *testing.T) {
	state, err := ClassifyDocuments([]ResourceDocument{
		doc("d.yaml", "Dashboard"), doc("r.yaml", "Runbook"), doc("n.yaml", "Notebook"), doc("a.yaml", "AlertRule"),
	})
	if err != nil {
		t.Fatal(err)
	}
	pathsOf := func(entries []api.ResourceEntry) []string {
		var out []string
		for _, e := range entries {
			out = append(out, e.Path)
		}
		return out
	}
	if got := [][]string{pathsOf(state.Dashboards), pathsOf(state.Runbooks), pathsOf(state.Alerts)}; !reflect.DeepEqual(got,
		[][]string{{"d.yaml"}, {"r.yaml", "n.yaml"}, {"a.yaml"}}) {
		t.Errorf("classified = %v", got)
	}
}

func TestClassifyRejectsUnsupportedKinds(t *testing.T) {
	for _, kind := range []string{"AlertSettings", "CCAlertRule", "CCReceiver"} {
		_, err := ClassifyDocuments([]ResourceDocument{doc("x.yaml", kind)})
		if err == nil || !strings.Contains(err.Error(), kind) || !strings.Contains(err.Error(), "Dashboard, Runbook, AlertRule") {
			t.Errorf("%s: err = %v", kind, err)
		}
	}
	if _, err := ClassifyDocuments([]ResourceDocument{{Path: "x.yaml", Document: map[string]any{}}}); err == nil {
		t.Error("document without kind was accepted")
	}
}

func TestResolvePreviewName(t *testing.T) {
	if got, _ := ResolvePreviewName(t.TempDir(), " gio/x "); got != "gio/x" {
		t.Errorf("explicit name = %q", got)
	}
	if _, err := ResolvePreviewName(t.TempDir(), ""); err == nil || !strings.Contains(err.Error(), "--preview") {
		t.Errorf("outside git: err = %v", err)
	}
	repo := t.TempDir()
	if out, err := exec.Command("git", "-C", repo, "init", "-q", "-b", "gio/preview-test").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	if got, err := ResolvePreviewName(repo, ""); got != "gio/preview-test" {
		t.Errorf("branch name = %q, %v", got, err)
	}
}

func TestInlinesRunbookMarkdownFilesRecursively(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "runbooks/index.md", "# Index\n")
	write(t, dir, "runbooks/triage/net.md", "# Net\n")
	write(t, dir, "runbooks/rb.yaml", "kind: Runbook\nmetadata:\n  name: rb\nspec:\n"+
		"  markdown:\n    file: ./index.md\n"+
		"  pages:\n    - name: triage\n      markdown:\n        inline: already inline\n"+
		"      pages:\n        - name: net\n          markdown:\n            file: ./triage/net.md\n")

	docs := load(t, dir)
	spec := docs[0].Document.(map[string]any)["spec"].(map[string]any)
	page := spec["pages"].([]any)[0].(map[string]any)
	nested := page["pages"].([]any)[0].(map[string]any)
	for _, tc := range []struct {
		got  any
		want string
	}{
		{spec["markdown"], `{"file":"./index.md","inline":"# Index\n"}`},
		{page["markdown"], `{"inline":"already inline"}`},
		{nested["markdown"], `{"file":"./triage/net.md","inline":"# Net\n"}`},
	} {
		if got := asJSON(t, tc.got); got != tc.want {
			t.Errorf("markdown = %s, want %s", got, tc.want)
		}
	}
}

func TestRunbookMarkdownMissingFileNamesBothPaths(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "rb.yaml", "kind: Notebook\nmetadata:\n  name: rb\nspec:\n  markdown:\n    file: ./missing.md\n")
	_, err := LoadResourceDocuments(dir)
	if err == nil || !strings.Contains(err.Error(), "rb.yaml") || !strings.Contains(err.Error(), "missing.md") ||
		strings.Contains(err.Error(), "directory tree") {
		t.Errorf("err = %v", err)
	}
}

func TestRunbookMarkdownOutsideTheApplyDirIsRejected(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	write(t, outside, "secret.md", "secret")
	write(t, dir, "rb.yaml", "kind: Notebook\nmetadata:\n  name: rb\nspec:\n  markdown:\n    file: "+filepath.Join(outside, "secret.md")+"\n")
	if _, err := LoadResourceDocuments(dir); err == nil || !strings.Contains(err.Error(), "outside") {
		t.Errorf("err = %v", err)
	}
}

func TestNonRunbookDocumentsAreNotInlined(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "d.yaml", dash+"  markdown:\n    file: ./nope.md\n")
	spec := load(t, dir)[0].Document.(map[string]any)["spec"].(map[string]any)
	if got := asJSON(t, spec["markdown"]); got != `{"file":"./nope.md"}` {
		t.Errorf("markdown = %s", got)
	}
}
