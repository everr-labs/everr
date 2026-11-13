package skills

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"github.com/everr-labs/everr/packages/cli/internal/assets"
)

// Skills that were renamed or merged. `skills update` replaces an installed
// legacy skill with its successor.
var legacySkillRenames = [][2]string{
	{"everr-ci-debugging", "everr-working-with-ci"},
	{"everr-local-telemetry-setup", "everr-setup-telemetry"},
	{"everr-local-debugging", "everr-use-telemetry"},
	{"everr-write-dashboards", "everr-setup-resources"},
	{"everr-write-runbooks", "everr-setup-resources"},
	{"everr-write-notebooks", "everr-setup-resources"},
}

// Provider is an agent that reads skills from its own directory.
type Provider int

const (
	Codex Provider = iota
	ClaudeCode
	Cursor
)

// AllProviders is every provider, in the order they are processed and shown.
var AllProviders = []Provider{Codex, ClaudeCode, Cursor}

func (p Provider) String() string {
	switch p {
	case Codex:
		return "codex"
	case ClaudeCode:
		return "claude-code"
	default:
		return "cursor"
	}
}

func (p Provider) DisplayName() string {
	switch p {
	case Codex:
		return "Codex"
	case ClaudeCode:
		return "Claude Code"
	default:
		return "Cursor"
	}
}

type Scope int

const (
	ScopeProject Scope = iota
	ScopeGlobal
)

// Options selects what an install, update, or uninstall touches. Empty
// Providers means every provider.
type Options struct {
	Scope      Scope
	Cwd        string
	HomeDir    string
	Providers  []Provider
	SkillNames []string
	All        bool
	DryRun     bool
}

type PathAction int

const (
	WouldWrite PathAction = iota
	Written
	Unchanged
	WouldRemove
	Removed
	Missing
	WouldLink
	Linked
)

func (a PathAction) String() string {
	return [...]string{"would write", "wrote", "unchanged", "would remove", "removed", "missing", "would link", "linked"}[a]
}

type PathChange struct {
	Skill string
	// Provider is nil for the canonical .agents/skills copy.
	Provider      *Provider
	Path          string
	CanonicalPath string
	Action        PathAction
}

type Summary struct {
	Skills  []string
	Changes []PathChange
	DryRun  bool
}

type BundledSkill struct {
	Name        string
	Description string
}

type ProviderStatus struct {
	Provider Provider
	Detected bool
	Path     string
}

func bundle() (fs.FS, error) {
	fsys, ok := assets.Skills()
	if !ok {
		return nil, errors.New("bundled skills are missing from this build")
	}
	return fsys, nil
}

// Bundled lists the skills shipped with this binary, sorted by name.
func Bundled() ([]BundledSkill, error) {
	fsys, err := bundle()
	if err != nil {
		return nil, err
	}
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return nil, err
	}
	var skills []BundledSkill
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skill, err := bundledSkillFromDir(fsys, entry.Name())
		if err != nil {
			return nil, err
		}
		skills = append(skills, skill)
	}
	sort.Slice(skills, func(i, j int) bool { return skills[i].Name < skills[j].Name })
	return skills, nil
}

func ProviderStatuses(homeDir string) []ProviderStatus {
	statuses := make([]ProviderStatus, 0, len(AllProviders))
	for _, provider := range AllProviders {
		root := filepath.Join(homeDir, providerRootDir(provider))
		detected := exists(root) || (provider == Codex && exists("/etc/codex"))
		statuses = append(statuses, ProviderStatus{
			Provider: provider,
			Detected: detected,
			Path:     globalProviderSkillsDir(homeDir, provider),
		})
	}
	return statuses
}

// Install writes the selected bundled skills to the canonical .agents/skills
// directory and links each provider's skills directory to it.
func Install(options Options) (Summary, error) {
	names, err := resolveSkillNames(options)
	if err != nil {
		return Summary{}, err
	}
	fsys, err := bundle()
	if err != nil {
		return Summary{}, err
	}
	var changes []PathChange
	for _, name := range names {
		canonicalDir := canonicalSkillDir(options, name)
		change, err := syncBundledSkillDir(fsys, name, canonicalDir, options.DryRun)
		if err != nil {
			return Summary{}, err
		}
		changes = append(changes, change)

		for _, provider := range normalizeProviders(options.Providers) {
			providerDir := providerSkillDir(options, provider, name)
			if samePath(providerDir, canonicalDir) {
				continue
			}
			change, err := linkProviderDir(provider, name, canonicalDir, providerDir, options.DryRun)
			if err != nil {
				return Summary{}, err
			}
			changes = append(changes, change)
		}
	}
	return Summary{Skills: names, Changes: changes, DryRun: options.DryRun}, nil
}

// Update reinstalls the selected skills, or every installed bundled skill when
// none are selected, replacing installed legacy skills with their successors.
func Update(options Options) (Summary, error) {
	var err error
	if !options.All && len(options.SkillNames) == 0 {
		options.SkillNames, err = InstalledUpdateSkillNames(options)
	} else if !options.All {
		options.SkillNames, err = NormalizeUpdateSkillNames(options.SkillNames)
	}
	if err != nil {
		return Summary{}, err
	}

	legacyChanges, err := removeLegacySkillsSelectedForUpdate(options)
	if err != nil {
		return Summary{}, err
	}

	summary, err := Install(options)
	if err != nil {
		return Summary{}, err
	}
	if len(legacyChanges) > 0 {
		summary.Changes = append(legacyChanges, summary.Changes...)
	}
	return summary, nil
}

// Uninstall removes the selected skills from the canonical directory and every
// selected provider.
func Uninstall(options Options) (Summary, error) {
	names, err := resolveSkillNames(options)
	if err != nil {
		return Summary{}, err
	}
	var changes []PathChange
	for _, name := range names {
		removed, err := removeInstalledSkillPaths(options, name)
		if err != nil {
			return Summary{}, err
		}
		changes = append(changes, removed...)
	}
	return Summary{Skills: names, Changes: changes, DryRun: options.DryRun}, nil
}

func bundledSkillFromDir(fsys fs.FS, dir string) (BundledSkill, error) {
	docPath := path.Join(dir, "SKILL.md")
	content, err := fs.ReadFile(fsys, docPath)
	if err != nil {
		return BundledSkill{}, fmt.Errorf("bundled skill %s is missing SKILL.md", dir)
	}
	name, description, err := parseSkillFrontmatter(string(content))
	if err != nil {
		return BundledSkill{}, fmt.Errorf("parse %s: %w", docPath, err)
	}
	if name != dir {
		return BundledSkill{}, fmt.Errorf("bundled skill directory %s has frontmatter name %s", dir, name)
	}
	return BundledSkill{Name: name, Description: description}, nil
}

func parseSkillFrontmatter(content string) (name, description string, err error) {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	if len(lines) == 0 || lines[0] != "---" {
		return "", "", errors.New("missing frontmatter")
	}
	fields := map[string]string{}
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "---" {
			name, ok := fields["name"]
			if !ok {
				return "", "", errors.New("missing frontmatter field: name")
			}
			description, ok := fields["description"]
			if !ok {
				return "", "", errors.New("missing frontmatter field: description")
			}
			return name, description, nil
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		fields[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	return "", "", errors.New("unterminated frontmatter")
}

func bundledNames() (map[string]bool, error) {
	skills, err := Bundled()
	if err != nil {
		return nil, err
	}
	names := make(map[string]bool, len(skills))
	for _, skill := range skills {
		names[skill.Name] = true
	}
	return names, nil
}

// resolveSkillNames returns the selected bundled skill names, sorted and
// deduplicated.
func resolveSkillNames(options Options) ([]string, error) {
	available, err := bundledNames()
	if err != nil {
		return nil, err
	}
	var names []string
	if options.All {
		for name := range available {
			names = append(names, name)
		}
	} else {
		for _, name := range options.SkillNames {
			if name = strings.TrimSpace(name); name != "" {
				names = append(names, name)
			}
		}
	}
	if len(names) == 0 {
		return nil, errors.New("provide at least one skill name or use --all")
	}
	for _, name := range names {
		if err := validateSkillName(name); err != nil {
			return nil, err
		}
		if !available[name] {
			return nil, fmt.Errorf("unknown skill %q", name)
		}
	}
	slices.Sort(names)
	return slices.Compact(names), nil
}

// InstalledBundledSkillNames lists bundled skills whose SKILL.md is present in
// the scope's canonical directory.
func InstalledBundledSkillNames(options Options) ([]string, error) {
	skills, err := Bundled()
	if err != nil {
		return nil, err
	}
	var installed []string
	for _, skill := range skills {
		info, err := os.Stat(filepath.Join(canonicalSkillDir(options, skill.Name), "SKILL.md"))
		if err == nil && info.Mode().IsRegular() {
			installed = append(installed, skill.Name)
		}
	}
	return installed, nil
}

// InstalledUpdateSkillNames lists what `skills update` refreshes: installed
// bundled skills plus the successors of installed legacy skills.
func InstalledUpdateSkillNames(options Options) ([]string, error) {
	names, err := InstalledBundledSkillNames(options)
	if err != nil {
		return nil, err
	}
	for _, rename := range legacySkillRenames {
		if skillPathExists(options, rename[0]) {
			names = append(names, rename[1])
		}
	}
	slices.Sort(names)
	return slices.Compact(names), nil
}

// NormalizeUpdateSkillNames validates requested names and maps legacy names to
// their successors.
func NormalizeUpdateSkillNames(skillNames []string) ([]string, error) {
	available, err := bundledNames()
	if err != nil {
		return nil, err
	}
	var names []string
	for _, raw := range skillNames {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		if err := validateSkillName(name); err != nil {
			return nil, err
		}
		normalized := name
		if renamed, ok := renamedSkillName(name); ok {
			normalized = renamed
		}
		if !available[normalized] {
			return nil, fmt.Errorf("unknown skill %q", name)
		}
		names = append(names, normalized)
	}
	if len(names) == 0 {
		return nil, errors.New("provide at least one skill name")
	}
	slices.Sort(names)
	return slices.Compact(names), nil
}

func validateSkillName(name string) error {
	if name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("invalid skill name %q", name)
	}
	return nil
}

func renamedSkillName(name string) (string, bool) {
	for _, rename := range legacySkillRenames {
		if rename[0] == name {
			return rename[1], true
		}
	}
	return "", false
}

func normalizeProviders(providers []Provider) []Provider {
	if len(providers) == 0 {
		return slices.Clone(AllProviders)
	}
	out := slices.Clone(providers)
	slices.Sort(out)
	return slices.Compact(out)
}

func canonicalSkillsDir(options Options) string {
	base := options.Cwd
	if options.Scope == ScopeGlobal {
		base = options.HomeDir
	}
	return filepath.Join(base, ".agents", "skills")
}

func canonicalSkillDir(options Options, name string) string {
	return filepath.Join(canonicalSkillsDir(options), name)
}

func providerSkillsDir(options Options, provider Provider) string {
	if options.Scope == ScopeGlobal {
		return globalProviderSkillsDir(options.HomeDir, provider)
	}
	// Codex and Cursor read project skills from .agents/skills directly.
	if provider == ClaudeCode {
		return filepath.Join(options.Cwd, ".claude", "skills")
	}
	return canonicalSkillsDir(options)
}

func providerSkillDir(options Options, provider Provider, name string) string {
	return filepath.Join(providerSkillsDir(options, provider), name)
}

func providerRootDir(provider Provider) string {
	switch provider {
	case Codex:
		return ".codex"
	case ClaudeCode:
		return ".claude"
	default:
		return ".cursor"
	}
}

func globalProviderSkillsDir(homeDir string, provider Provider) string {
	return filepath.Join(homeDir, providerRootDir(provider), "skills")
}

func skillPathExists(options Options, name string) bool {
	if lexists(canonicalSkillDir(options, name)) {
		return true
	}
	for _, provider := range normalizeProviders(options.Providers) {
		if lexists(providerSkillDir(options, provider, name)) {
			return true
		}
	}
	return false
}

func removeLegacySkillsSelectedForUpdate(options Options) ([]PathChange, error) {
	selected := map[string]bool{}
	if options.All {
		for _, rename := range legacySkillRenames {
			selected[rename[1]] = true
		}
	} else {
		for _, name := range options.SkillNames {
			selected[name] = true
		}
	}
	var changes []PathChange
	for _, rename := range legacySkillRenames {
		if selected[rename[1]] && skillPathExists(options, rename[0]) {
			removed, err := removeInstalledSkillPaths(options, rename[0])
			if err != nil {
				return nil, err
			}
			changes = append(changes, removed...)
		}
	}
	return changes, nil
}

func removeInstalledSkillPaths(options Options, name string) ([]PathChange, error) {
	canonicalDir := canonicalSkillDir(options, name)
	var changes []PathChange
	for _, provider := range normalizeProviders(options.Providers) {
		providerDir := providerSkillDir(options, provider, name)
		// Compare literally, not with samePath: resolving symlinks would match a
		// provider link to the canonical dir, skip it, and leave it dangling
		// once the canonical dir is removed below.
		if providerDir == canonicalDir {
			continue
		}
		change, err := removePath(name, &provider, providerDir, canonicalDir, options.DryRun)
		if err != nil {
			return nil, err
		}
		changes = append(changes, change)
	}
	change, err := removePath(name, nil, canonicalDir, "", options.DryRun)
	if err != nil {
		return nil, err
	}
	return append(changes, change), nil
}

func syncBundledSkillDir(fsys fs.FS, name, target string, dryRun bool) (PathChange, error) {
	change := PathChange{Skill: name, Path: target, Action: Written}
	if dryRun {
		change.Action = WouldWrite
	}
	state, missing, err := existingDirState(fsys, name, target)
	if err != nil {
		return PathChange{}, err
	}
	switch state {
	case dirSame:
		change.Action = Unchanged
		return change, nil
	case dirMissingBundledFiles:
		if !dryRun {
			if err := writeFiles(target, missing); err != nil {
				return PathChange{}, err
			}
		}
	case dirDifferent:
		if !dryRun {
			if err := removeAny(target); err != nil {
				return PathChange{}, err
			}
			if err := writeBundledDir(fsys, name, target); err != nil {
				return PathChange{}, err
			}
		}
	case dirMissing:
		if !dryRun {
			if err := writeBundledDir(fsys, name, target); err != nil {
				return PathChange{}, err
			}
		}
	}
	return change, nil
}

type dirState int

const (
	dirMissing dirState = iota
	dirSame
	// dirMissingBundledFiles: every file present matches the bundle, some bundled
	// files are absent, so only those need writing.
	dirMissingBundledFiles
	dirDifferent
)

func existingDirState(fsys fs.FS, name, target string) (dirState, map[string][]byte, error) {
	info, err := os.Lstat(target)
	if err != nil {
		return dirMissing, nil, nil
	}
	if !info.IsDir() {
		return dirDifferent, nil, nil
	}
	expected, err := bundledFileMap(fsys, name)
	if err != nil {
		return 0, nil, err
	}
	actual, err := fileMap(target)
	if err != nil {
		return 0, nil, err
	}
	for relative, contents := range actual {
		if want, ok := expected[relative]; !ok || !bytes.Equal(want, contents) {
			return dirDifferent, nil, nil
		}
	}
	if len(actual) == len(expected) {
		return dirSame, nil, nil
	}
	missing := map[string][]byte{}
	for relative, contents := range expected {
		if _, ok := actual[relative]; ok {
			continue
		}
		// Something not tracked as a file (a symlink, a directory) sits where a
		// bundled file should go, so a full rewrite is needed.
		if _, err := os.Lstat(filepath.Join(target, filepath.FromSlash(relative))); !errors.Is(err, fs.ErrNotExist) {
			return dirDifferent, nil, nil
		}
		missing[relative] = contents
	}
	return dirMissingBundledFiles, missing, nil
}

func writeFiles(target string, files map[string][]byte) error {
	for relative, contents := range files {
		dest := filepath.Join(target, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return fmt.Errorf("create %s: %w", filepath.Dir(dest), err)
		}
		if err := os.WriteFile(dest, contents, 0o644); err != nil {
			return fmt.Errorf("write %s: %w", dest, err)
		}
	}
	return nil
}

func bundledFileMap(fsys fs.FS, name string) (map[string][]byte, error) {
	files := map[string][]byte{}
	err := fs.WalkDir(fsys, name, func(p string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		contents, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		files[strings.TrimPrefix(p, name+"/")] = contents
		return nil
	})
	return files, err
}

// fileMap reads the regular files under root, keyed by slash-separated
// relative path. Symlinks are skipped.
func fileMap(root string) (map[string][]byte, error) {
	files := map[string][]byte{}
	err := filepath.WalkDir(root, func(p string, entry fs.DirEntry, err error) error {
		if err != nil {
			return fmt.Errorf("read %s: %w", p, err)
		}
		if entry.IsDir() || entry.Type()&fs.ModeSymlink != 0 {
			return nil
		}
		relative, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		contents, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(relative)] = contents
		return nil
	})
	return files, err
}

func writeBundledDir(fsys fs.FS, name, target string) error {
	return fs.WalkDir(fsys, name, func(p string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		dest := filepath.Join(target, filepath.FromSlash(strings.TrimPrefix(strings.TrimPrefix(p, name), "/")))
		if entry.IsDir() {
			if err := os.MkdirAll(dest, 0o755); err != nil {
				return fmt.Errorf("create %s: %w", dest, err)
			}
			return nil
		}
		contents, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		if err := os.WriteFile(dest, contents, 0o644); err != nil {
			return fmt.Errorf("write %s: %w", dest, err)
		}
		return nil
	})
}

func linkProviderDir(provider Provider, name, canonicalDir, providerDir string, dryRun bool) (PathChange, error) {
	change := PathChange{Skill: name, Provider: &provider, Path: providerDir, CanonicalPath: canonicalDir}
	pointsTo, err := providerLinkPointsTo(providerDir, canonicalDir)
	if err != nil {
		return PathChange{}, err
	}
	if pointsTo {
		change.Action = Unchanged
		return change, nil
	}
	change.Action = WouldLink
	if dryRun {
		return change, nil
	}
	if lexists(providerDir) {
		if err := removeAny(providerDir); err != nil {
			return PathChange{}, err
		}
	}
	parent := filepath.Dir(providerDir)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return PathChange{}, fmt.Errorf("create %s: %w", parent, err)
	}
	if err := os.Symlink(relativeSymlinkTarget(canonicalDir, providerDir), providerDir); err != nil {
		return PathChange{}, fmt.Errorf("create symlink %s -> %s: %w", providerDir, canonicalDir, err)
	}
	change.Action = Linked
	return change, nil
}

func providerLinkPointsTo(providerDir, canonicalDir string) (bool, error) {
	info, err := os.Lstat(providerDir)
	if err != nil || info.Mode()&fs.ModeSymlink == 0 {
		return false, nil
	}
	link, err := os.Readlink(providerDir)
	if err != nil {
		return false, err
	}
	if !filepath.IsAbs(link) {
		link = filepath.Join(filepath.Dir(providerDir), link)
	}
	resolved, resolvedErr := filepath.EvalSymlinks(link)
	canonical, canonicalErr := filepath.EvalSymlinks(canonicalDir)
	if resolvedErr != nil || canonicalErr != nil {
		// Two unresolvable paths compare equal, as they did in the previous CLI.
		return resolvedErr != nil && canonicalErr != nil, nil
	}
	return resolved == canonical, nil
}

// Links are relative so a moved home or project directory keeps working.
func relativeSymlinkTarget(target, link string) string {
	relative, err := filepath.Rel(filepath.Dir(link), target)
	if err != nil {
		return target
	}
	return relative
}

func removePath(name string, provider *Provider, p, canonicalPath string, dryRun bool) (PathChange, error) {
	change := PathChange{Skill: name, Provider: provider, Path: p, CanonicalPath: canonicalPath}
	switch {
	case !lexists(p):
		change.Action = Missing
	case dryRun:
		change.Action = WouldRemove
	default:
		if err := removeAny(p); err != nil {
			return PathChange{}, err
		}
		change.Action = Removed
	}
	return change, nil
}

func removeAny(p string) error {
	info, err := os.Lstat(p)
	if err != nil {
		return fmt.Errorf("read %s: %w", p, err)
	}
	if info.IsDir() {
		err = os.RemoveAll(p)
	} else {
		err = os.Remove(p)
	}
	if err != nil {
		return fmt.Errorf("remove %s: %w", p, err)
	}
	return nil
}

func samePath(a, b string) bool {
	if a == b {
		return true
	}
	resolvedA, err := filepath.EvalSymlinks(a)
	if err != nil {
		return false
	}
	resolvedB, err := filepath.EvalSymlinks(b)
	return err == nil && resolvedA == resolvedB
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func lexists(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}
