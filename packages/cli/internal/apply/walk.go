package apply

import (
	"bufio"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// The walk reproduces the subset of git's ignore rules that apply honors:
// `.ignore` and `.gitignore` files inside the tree and in its ancestors,
// plus `.git/info/exclude`. Gitignore files apply up to the nearest
// repository root, and are honored outside a repository too. Global excludes
// are deliberately not read, so a destructive reconcile never depends on
// machine-wide configuration. Hidden entries are skipped unless an ignore
// file whitelists them.

type ignorePattern struct {
	re      *regexp.Regexp
	negate  bool
	dirOnly bool
}

// ignoreFile holds the patterns read from one file, matched against paths
// relative to dir.
type ignoreFile struct {
	dir      string
	patterns []ignorePattern
}

type match int

const (
	noMatch match = iota
	ignored
	whitelisted
)

func (f *ignoreFile) match(path string, isDir bool) match {
	rel, err := filepath.Rel(f.dir, path)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return noMatch
	}
	rel = filepath.ToSlash(rel)
	for i := len(f.patterns) - 1; i >= 0; i-- {
		p := f.patterns[i]
		if p.dirOnly && !isDir {
			continue
		}
		if p.re.MatchString(rel) {
			if p.negate {
				return whitelisted
			}
			return ignored
		}
	}
	return noMatch
}

func readIgnoreFile(dir, path string) (*ignoreFile, error) {
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	ignore := &ignoreFile{dir: dir}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if p, ok := parseIgnoreLine(scanner.Text()); ok {
			ignore.patterns = append(ignore.patterns, p)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(ignore.patterns) == 0 {
		return nil, nil
	}
	return ignore, nil
}

func parseIgnoreLine(line string) (ignorePattern, bool) {
	line = strings.TrimSuffix(line, "\r")
	if line == "" || strings.HasPrefix(line, "#") {
		return ignorePattern{}, false
	}
	// Trailing spaces are dropped unless escaped.
	for strings.HasSuffix(line, " ") && !strings.HasSuffix(line, "\\ ") {
		line = line[:len(line)-1]
	}
	var p ignorePattern
	switch {
	case strings.HasPrefix(line, "!"):
		p.negate = true
		line = line[1:]
	case strings.HasPrefix(line, "\\!"), strings.HasPrefix(line, "\\#"):
		line = line[1:]
	}
	if strings.HasSuffix(line, "/") && line != "/" {
		p.dirOnly = true
		line = strings.TrimSuffix(line, "/")
	}
	if line == "" {
		return ignorePattern{}, false
	}
	// Without a slash a pattern matches at any depth; otherwise it is
	// anchored to the ignore file's directory.
	if !strings.Contains(line, "/") {
		line = "**/" + line
	} else {
		line = strings.TrimPrefix(line, "/")
	}
	re, err := regexp.Compile("^" + globToRegexp(line) + "$")
	if err != nil {
		return ignorePattern{}, false
	}
	p.re = re
	return p, true
}

func globToRegexp(glob string) string {
	var b strings.Builder
	for i := 0; i < len(glob); i++ {
		c := glob[i]
		switch {
		case strings.HasPrefix(glob[i:], "**/") && (i == 0 || glob[i-1] == '/'):
			b.WriteString("(?:.*/)?")
			i += 2
		case strings.HasPrefix(glob[i:], "**") && i+2 == len(glob) && (i == 0 || glob[i-1] == '/'):
			b.WriteString(".*")
			i++
		case c == '*':
			b.WriteString("[^/]*")
		case c == '?':
			b.WriteString("[^/]")
		case c == '\\' && i+1 < len(glob):
			i++
			b.WriteString(regexp.QuoteMeta(string(glob[i])))
		case c == '[':
			end := strings.IndexByte(glob[i+1:], ']')
			if end < 0 {
				b.WriteString(regexp.QuoteMeta("["))
				continue
			}
			class := glob[i+1 : i+1+end]
			if strings.HasPrefix(class, "!") {
				class = "^" + class[1:]
			}
			b.WriteString("[" + strings.ReplaceAll(class, "\\", "\\\\") + "]")
			i += end + 1
		default:
			b.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	return b.String()
}

// ignoreLevel is the ignore files of one directory.
type ignoreLevel struct {
	ignore, gitignore, exclude *ignoreFile
	hasGit                     bool
}

func loadLevel(dir string) (ignoreLevel, error) {
	var level ignoreLevel
	var err error
	if level.ignore, err = readIgnoreFile(dir, filepath.Join(dir, ".ignore")); err != nil {
		return level, err
	}
	if level.gitignore, err = readIgnoreFile(dir, filepath.Join(dir, ".gitignore")); err != nil {
		return level, err
	}
	if _, statErr := os.Stat(filepath.Join(dir, ".git")); statErr == nil {
		level.hasGit = true
		if level.exclude, err = readIgnoreFile(dir, filepath.Join(gitCommonDir(dir), "info", "exclude")); err != nil {
			return level, err
		}
	}
	return level, nil
}

// gitCommonDir returns the directory holding the repository's shared files,
// like info/exclude. In a worktree or submodule, .git is a file pointing at
// the real git directory, and a worktree's git directory points further at
// the main repository's through its commondir file.
func gitCommonDir(dir string) string {
	gitDir := filepath.Join(dir, ".git")
	if info, err := os.Stat(gitDir); err != nil || info.IsDir() {
		return gitDir
	}
	if target, ok := readGitPointer(filepath.Join(dir, ".git"), "gitdir:"); ok {
		gitDir = resolveFrom(dir, target)
	}
	if common, err := os.ReadFile(filepath.Join(gitDir, "commondir")); err == nil {
		return resolveFrom(gitDir, strings.TrimSpace(string(common)))
	}
	return gitDir
}

func readGitPointer(path, prefix string) (string, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	target, ok := strings.CutPrefix(strings.TrimSpace(string(data)), prefix)
	return strings.TrimSpace(target), ok
}

func resolveFrom(base, path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(base, path)
}

// matchLevels checks levels from the deepest directory outwards. `.ignore`
// rules take precedence over gitignore rules; gitignore rules stop at the
// first repository root.
func matchLevels(levels []ignoreLevel, path string, isDir bool) match {
	result := func(pick func(ignoreLevel) *ignoreFile, stopAtGit bool) match {
		for i := len(levels) - 1; i >= 0; i-- {
			if file := pick(levels[i]); file != nil {
				if m := file.match(path, isDir); m != noMatch {
					return m
				}
			}
			if stopAtGit && levels[i].hasGit {
				break
			}
		}
		return noMatch
	}
	if m := result(func(l ignoreLevel) *ignoreFile { return l.ignore }, false); m != noMatch {
		return m
	}
	if m := result(func(l ignoreLevel) *ignoreFile { return l.gitignore }, true); m != noMatch {
		return m
	}
	return result(func(l ignoreLevel) *ignoreFile { return l.exclude }, true)
}

// walkFiles calls visit with every regular file under root that is neither
// hidden nor ignored, in lexical order. Symlinks are not followed. Errors from
// visit are returned as is.
func walkFiles(root string, visit func(path string) error) error {
	treeErr := func(err error) error {
		return fmt.Errorf("failed to read directory tree under %s: %w", root, err)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return treeErr(err)
	}
	var levels []ignoreLevel
	var ancestors []string
	for dir := filepath.Dir(abs); ; dir = filepath.Dir(dir) {
		ancestors = append(ancestors, dir)
		if filepath.Dir(dir) == dir {
			break
		}
	}
	for i := len(ancestors) - 1; i >= 0; i-- {
		level, err := loadLevel(ancestors[i])
		if err != nil {
			return treeErr(err)
		}
		levels = append(levels, level)
	}

	var walk func(dir, relDir string, levels []ignoreLevel) error
	walk = func(dir, relDir string, levels []ignoreLevel) error {
		level, err := loadLevel(dir)
		if err != nil {
			return treeErr(err)
		}
		levels = append(levels[:len(levels):len(levels)], level)
		entries, err := os.ReadDir(dir)
		if err != nil {
			return treeErr(err)
		}
		for _, entry := range entries {
			path := filepath.Join(dir, entry.Name())
			rel := filepath.Join(relDir, entry.Name())
			isDir := entry.IsDir()
			switch matchLevels(levels, path, isDir) {
			case ignored:
				continue
			case noMatch:
				if strings.HasPrefix(entry.Name(), ".") {
					continue
				}
			}
			switch {
			case isDir:
				if err := walk(path, rel, levels); err != nil {
					return err
				}
			case entry.Type().IsRegular():
				if err := visit(rel); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return walk(abs, "", levels)
}
