// Package apply implements `everr apply`: it loads a directory of as-code
// resources and reconciles it with Everr.
package apply

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/everr-labs/everr/packages/cli/internal/api"
	"github.com/everr-labs/everr/packages/cli/internal/git"
)

// ResourceDocument is a resource file found on disk: its POSIX path relative
// to the apply directory and its parsed contents as JSON values.
type ResourceDocument struct {
	Path     string
	Document any
}

var manifestFiles = []string{"everr.yaml", "everr.yml"}

func isResourceFile(name string) bool {
	switch filepath.Ext(name) {
	case ".yaml", ".yml", ".json":
		return true
	}
	return false
}

func isManifestFile(name string) bool {
	return name == manifestFiles[0] || name == manifestFiles[1]
}

func parseDocument(path string, contents []byte) (any, error) {
	if filepath.Ext(path) == ".json" {
		return parseJSON(contents)
	}
	return parseYAML(contents)
}

func parseJSON(contents []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, errors.New("trailing characters after the JSON value")
	}
	return value, nil
}

// parseYAML reads exactly one YAML document into JSON values. It decodes
// through yaml.Node so that YAML 1.1 types JSON has no notion of (such as
// timestamps) stay strings.
func parseYAML(contents []byte) (any, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(contents))
	var doc yaml.Node
	if err := decoder.Decode(&doc); err != nil {
		if err == io.EOF {
			return nil, nil
		}
		return nil, err
	}
	var extra yaml.Node
	if err := decoder.Decode(&extra); err != io.EOF {
		if err != nil {
			return nil, err
		}
		return nil, errors.New("deserializing from YAML containing more than one document is not supported")
	}
	return yamlToJSON(&doc)
}

func yamlToJSON(node *yaml.Node) (any, error) {
	switch node.Kind {
	case yaml.DocumentNode:
		if len(node.Content) == 0 {
			return nil, nil
		}
		return yamlToJSON(node.Content[0])
	case yaml.AliasNode:
		return yamlToJSON(node.Alias)
	case yaml.SequenceNode:
		out := make([]any, 0, len(node.Content))
		for _, item := range node.Content {
			value, err := yamlToJSON(item)
			if err != nil {
				return nil, err
			}
			out = append(out, value)
		}
		return out, nil
	case yaml.MappingNode:
		out := make(map[string]any, len(node.Content)/2)
		for i := 0; i+1 < len(node.Content); i += 2 {
			keyNode := node.Content[i]
			if keyNode.Kind == yaml.AliasNode {
				keyNode = keyNode.Alias
			}
			key := keyNode.Value
			if _, dup := out[key]; dup {
				return nil, fmt.Errorf("line %d: duplicate entry with key %q", keyNode.Line, key)
			}
			value, err := yamlToJSON(node.Content[i+1])
			if err != nil {
				return nil, err
			}
			out[key] = value
		}
		return out, nil
	}
	return yamlScalar(node)
}

var yaml12Int = regexp.MustCompile(`^[-+]?(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+)$`)

func yamlScalar(node *yaml.Node) (any, error) {
	if node.Style&(yaml.DoubleQuotedStyle|yaml.SingleQuotedStyle|yaml.LiteralStyle|yaml.FoldedStyle) != 0 {
		return node.Value, nil
	}
	switch node.ShortTag() {
	case "!!null":
		return nil, nil
	case "!!bool":
		var b bool
		if err := node.Decode(&b); err != nil {
			return nil, err
		}
		return b, nil
	case "!!int":
		// yaml.v3 reads YAML 1.1 integers, where a leading zero means octal
		// and underscores are separators. The YAML 1.2 core schema the
		// previous CLI used keeps those as strings, so `zip: 01234` stays
		// "01234" instead of becoming 668.
		if !yaml12Int.MatchString(node.Value) {
			return node.Value, nil
		}
		var i int64
		if node.Decode(&i) == nil {
			return json.Number(strconv.FormatInt(i, 10)), nil
		}
		var u uint64
		if node.Decode(&u) == nil {
			return json.Number(strconv.FormatUint(u, 10)), nil
		}
		var f float64
		if err := node.Decode(&f); err != nil {
			return nil, err
		}
		return f, nil
	case "!!float":
		var f float64
		if err := node.Decode(&f); err != nil {
			return nil, err
		}
		// JSON has no NaN or infinities.
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return nil, nil
		}
		return f, nil
	}
	return node.Value, nil
}

// LoadResourceDocuments loads every .yaml/.yml/.json resource under dir with
// its POSIX path relative to dir. Errors name the file.
//
// The returned set is the complete desired state and apply prunes anything
// missing, so ignored and hidden files are skipped (generated or scratch YAML
// is not desired state) and any walk error is returned rather than
// silently truncating the set.
func LoadResourceDocuments(dir string) ([]ResourceDocument, error) {
	var out []ResourceDocument
	err := walkFiles(dir, func(rel string) error {
		name := filepath.Base(rel)
		if isManifestFile(name) || !isResourceFile(name) {
			return nil
		}
		relPath := filepath.ToSlash(rel)
		contents, err := os.ReadFile(filepath.Join(dir, rel))
		if err != nil {
			return fmt.Errorf("%s: failed to read file: %w", relPath, err)
		}
		document, err := parseDocument(rel, contents)
		if err != nil {
			return fmt.Errorf("%s: failed to parse: %w", relPath, err)
		}
		if err := inlineRunbookMarkdown(dir, relPath, document); err != nil {
			return err
		}
		out = append(out, ResourceDocument{Path: relPath, Document: document})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func kindOf(document any) (string, bool) {
	object, ok := document.(map[string]any)
	if !ok {
		return "", false
	}
	kind, ok := object["kind"].(string)
	return kind, ok
}

// isRunbookKind accepts `Notebook`, the legacy alias for `Runbook`.
func isRunbookKind(kind string) bool {
	return kind == "Runbook" || kind == "Notebook"
}

// inlineRunbookMarkdown turns `markdown: {file: ...}` pointers in a Runbook
// into `markdown: {inline: ..., file: ...}`, reading files relative to the
// document. The server only accepts inline markdown; this keeps .md files
// first-class on disk.
func inlineRunbookMarkdown(root, docRelPath string, document any) error {
	kind, _ := kindOf(document)
	if !isRunbookKind(kind) {
		return nil
	}
	canonicalRoot, err := canonicalize(root)
	if err != nil {
		return fmt.Errorf("failed to resolve apply directory %s: %w", root, err)
	}
	docDir := filepath.Dir(filepath.FromSlash(docRelPath))
	if spec, ok := document.(map[string]any)["spec"]; ok {
		return inlineMarkdownNode(root, canonicalRoot, docDir, docRelPath, spec)
	}
	return nil
}

// inlineMarkdownNode handles one node with an optional `markdown` and
// optional nested `pages`; the spec root and every page share this shape.
func inlineMarkdownNode(root, canonicalRoot, docDir, docPath string, node any) error {
	object, ok := node.(map[string]any)
	if !ok {
		return nil
	}
	if markdown, ok := object["markdown"].(map[string]any); ok {
		if file, ok := markdown["file"].(string); ok {
			contents, err := readMarkdown(root, canonicalRoot, docDir, docPath, file)
			if err != nil {
				return err
			}
			// The file path stays so the web viewer can resolve relative
			// links between pages back to their source files.
			object["markdown"] = map[string]any{"inline": contents, "file": file}
		}
	}
	if pages, ok := object["pages"].([]any); ok {
		for _, page := range pages {
			if err := inlineMarkdownNode(root, canonicalRoot, docDir, docPath, page); err != nil {
				return err
			}
		}
	}
	return nil
}

func readMarkdown(root, canonicalRoot, docDir, docPath, file string) (string, error) {
	resolved := file
	if !filepath.IsAbs(file) {
		resolved = filepath.Join(root, docDir, file)
	}
	// The apply directory is the trust boundary: a `../../` pointer must not
	// upload arbitrary files.
	canonical, err := canonicalize(resolved)
	if err != nil {
		return "", fmt.Errorf("%s: failed to read markdown file %s: %w", docPath, file, err)
	}
	if canonical != canonicalRoot && !strings.HasPrefix(canonical, canonicalRoot+string(filepath.Separator)) {
		return "", fmt.Errorf("%s: markdown file %s is outside the apply directory", docPath, file)
	}
	contents, err := os.ReadFile(canonical)
	if err != nil {
		return "", fmt.Errorf("%s: failed to read markdown file %s: %w", docPath, file, err)
	}
	return string(contents), nil
}

func canonicalize(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(abs)
}

// LoadApplyManifest returns the repoid from everr.yaml (or everr.yml) at the
// apply root, or "" when there is no manifest.
func LoadApplyManifest(dir string) (string, error) {
	var name string
	for _, candidate := range manifestFiles {
		if info, err := os.Stat(filepath.Join(dir, candidate)); err == nil && info.Mode().IsRegular() {
			name = candidate
			break
		}
	}
	if name == "" {
		return "", nil
	}
	contents, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return "", fmt.Errorf("%s: failed to read file: %w", name, err)
	}
	value, err := parseManifest(contents)
	if err != nil {
		return "", fmt.Errorf("%s: failed to parse (it must contain only `repoid`): %w", name, err)
	}
	repoid := strings.TrimSpace(value)
	if repoid == "" {
		return "", fmt.Errorf("%s: repoid must be a non-empty string", name)
	}
	return repoid, nil
}

func parseManifest(contents []byte) (string, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal(contents, &doc); err != nil {
		return "", err
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return "", errors.New("expected a mapping with `repoid`")
	}
	mapping := doc.Content[0]
	var repoid *yaml.Node
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if key := mapping.Content[i].Value; key != "repoid" {
			return "", fmt.Errorf("unknown field `%s`, expected `repoid`", key)
		}
		repoid = mapping.Content[i+1]
	}
	if repoid == nil {
		return "", errors.New("missing field `repoid`")
	}
	if repoid.Kind != yaml.ScalarNode || repoid.ShortTag() == "!!null" {
		return "", errors.New("repoid: expected a string")
	}
	return repoid.Value, nil
}

// ResolveRepoid returns the apply ownership and prune boundary: the
// manifest's repoid when there is one, else the normalized origin remote
// (remote, as read by DetectGitSource). The manifest is the escape hatch for
// repositories without a remote and a pin against remote renames.
func ResolveRepoid(dir, remote string) (repoid string, fromManifest bool, err error) {
	repoid, err = LoadApplyManifest(dir)
	if err != nil || repoid != "" {
		return repoid, err == nil, err
	}
	if slug, ok := git.NormalizeRemoteSlug(remote); ok && remote != "" {
		return slug, false, nil
	}
	return "", false, fmt.Errorf("cannot determine the repository identity of %s: no `origin` git remote to infer it from and no everr.yaml manifest.\n"+
		"Either add an `origin` remote, or create everr.yaml with a stable repository id, e.g.\n"+
		"repoid: \"2f8e3f90-9d1c-5d5f-a0f9-2d8e7f4a25d1\"", dir)
}

// ResolveRepoidForDir resolves the repoid of dir the way apply does.
func ResolveRepoidForDir(dir string) (string, error) {
	repoid, _, err := ResolveRepoid(dir, OriginRemote(dir))
	return repoid, err
}

// ClassifyDocuments splits documents by kind. Unknown kinds (including
// AlertSettings, which is web-UI-only) are an error. Keep the kinds in sync
// with the server reconciler REGISTRY in
// packages/app/src/data/as-code/registry.ts.
func ClassifyDocuments(docs []ResourceDocument) (api.ApplyState, error) {
	var state api.ApplyState
	for _, doc := range docs {
		entry := api.ResourceEntry{Path: doc.Path, Resource: doc.Document}
		kind, ok := kindOf(doc.Document)
		switch {
		case !ok:
			return api.ApplyState{}, fmt.Errorf("%s: document is missing a string \"kind\"", doc.Path)
		case kind == "Dashboard":
			state.Dashboards = append(state.Dashboards, entry)
		case isRunbookKind(kind):
			state.Runbooks = append(state.Runbooks, entry)
		case kind == "AlertRule":
			state.Alerts = append(state.Alerts, entry)
		default:
			return api.ApplyState{}, fmt.Errorf("%s: unsupported kind %q (supported: Dashboard, Runbook, AlertRule)", doc.Path, kind)
		}
	}
	return state, nil
}

// OriginRemote is the origin remote URL of dir, or "".
func OriginRemote(dir string) string {
	remote, _ := git.Run(dir, "remote", "get-url", "origin")
	return remote
}

// DetectGitSource is best-effort git metadata for dir; nil when git knows
// nothing about it.
func DetectGitSource(dir string) *api.ApplySource {
	optional := func(args ...string) *string {
		if out, ok := git.Run(dir, args...); ok {
			return &out
		}
		return nil
	}
	source := &api.ApplySource{
		Branch:    optional("rev-parse", "--abbrev-ref", "HEAD"),
		CommitSHA: optional("rev-parse", "HEAD"),
	}
	if remote := OriginRemote(dir); remote != "" {
		source.Remote = &remote
	}
	if source.Branch == nil && source.CommitSHA == nil && source.Remote == nil {
		return nil
	}
	return source
}

// ResolvePreviewName picks the preview for `--preview [NAME]`: an explicit
// name wins, otherwise the current branch. Detached HEAD and non-git
// directories need an explicit name (as in CI).
func ResolvePreviewName(dir, flag string) (string, error) {
	if explicit := strings.TrimSpace(flag); explicit != "" {
		return explicit, nil
	}
	// symbolic-ref also resolves on an unborn branch, where rev-parse has no
	// commit to resolve.
	if branch, ok := git.Run(dir, "symbolic-ref", "--short", "-q", "HEAD"); ok {
		return branch, nil
	}
	if _, ok := git.Run(dir, "rev-parse", "HEAD"); ok {
		return "", errors.New("HEAD is detached; pass an explicit preview name: --preview <name>")
	}
	return "", fmt.Errorf("%s is not a git repository; pass an explicit preview name: --preview <name>", dir)
}
