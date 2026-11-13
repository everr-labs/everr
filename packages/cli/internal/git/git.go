// Package git reads repository context (repo, branch, commits, remotes) by
// running the git binary.
package git

import (
	"os/exec"
	"strings"
)

// Context is what the current checkout says about the repository. Empty
// fields could not be resolved.
type Context struct {
	Repo   string
	Branch string
}

// ResolveContext infers the owner/name repository from the origin remote and
// the current branch of the checkout at dir.
func ResolveContext(dir string) Context {
	var ctx Context
	if branch, ok := Run(dir, "rev-parse", "--abbrev-ref", "HEAD"); ok {
		ctx.Branch = NormalizeBranchName(branch)
	}
	if origin, ok := Run(dir, "config", "--get", "remote.origin.url"); ok {
		ctx.Repo, _ = ParseRepoFromRemoteURL(origin)
	}
	return ctx
}

// Run runs git in dir and returns its trimmed stdout. It reports false when
// git fails or prints nothing.
func Run(dir string, args ...string) (string, bool) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", false
	}
	trimmed := strings.TrimSpace(string(out))
	return trimmed, trimmed != ""
}

func NormalizeBranchName(raw string) string {
	if raw == "HEAD" {
		return raw
	}
	return strings.TrimPrefix(raw, "refs/heads/")
}

// NormalizeRemoteSlug turns a remote URL into the repoid slug
// `host/owner/repo`: scheme, credentials, port, one trailing `.git`, and
// trailing slashes are dropped and the result is lowercased, so the ssh,
// scp-like, and https URLs of one repository collapse to one identity.
// Nested paths (GitLab subgroups) keep their segments. Local-path and
// `file://` remotes have no host and report false.
//
// Unlike ParseRepoFromRemoteURL, this keeps the host and case-folds: the
// result is an identity key, so `github.com/a/b` and `gitlab.com/a/b` must
// stay distinct while casing variants must not.
func NormalizeRemoteSlug(remote string) (string, bool) {
	remote = strings.TrimRight(strings.TrimSpace(remote), "/")
	var authority, path string
	if scheme, rest, ok := strings.Cut(remote, "://"); ok {
		if scheme == "file" {
			return "", false
		}
		if authority, path, ok = strings.Cut(rest, "/"); !ok {
			return "", false
		}
	} else {
		// scp-like form ([user@]host:path): the colon must come before any
		// slash, otherwise this is a local path.
		var found bool
		authority, path, found = strings.Cut(remote, ":")
		if !found || authority == "" || strings.Contains(authority, "/") {
			return "", false
		}
	}
	host := authority
	if i := strings.LastIndex(host, "@"); i >= 0 {
		host = host[i+1:]
	}
	if h, port, ok := strings.Cut(host, ":"); ok && port != "" && allDigits(port) {
		host = h
	}
	path = strings.Trim(path, "/")
	path = strings.TrimSuffix(path, ".git")
	if host == "" || path == "" {
		return "", false
	}
	return strings.ToLower(host + "/" + path), true
}

func allDigits(s string) bool {
	for _, c := range []byte(s) {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// ParseRepoFromRemoteURL extracts the owner/name display label from a remote
// URL, keeping its case.
func ParseRepoFromRemoteURL(remoteURL string) (string, bool) {
	trimmed := strings.TrimSpace(remoteURL)
	if at := strings.Index(trimmed, "@"); at >= 0 {
		if colon := strings.Index(trimmed[at:], ":"); colon >= 0 {
			if repo, ok := stripDotGit(trimmed[at+colon+1:]); ok {
				return repo, true
			}
		}
	}
	if strings.Contains(trimmed, "://") {
		return parseRepoFromHTTPRemoteURL(trimmed)
	}
	if i := strings.LastIndex(trimmed, "/"); i >= 0 {
		rest := trimmed[:i]
		owner := rest[strings.LastIndex(rest, "/")+1:]
		return stripDotGit(owner + "/" + trimmed[i+1:])
	}
	return "", false
}

func parseRepoFromHTTPRemoteURL(remoteURL string) (string, bool) {
	_, authorityAndPath, _ := strings.Cut(remoteURL, "://")
	_, path, ok := strings.Cut(authorityAndPath, "/")
	if !ok {
		return "", false
	}
	var segments []string
	for _, segment := range strings.Split(path, "/") {
		if segment != "" {
			segments = append(segments, segment)
		}
	}
	if len(segments) < 2 {
		return "", false
	}
	return stripDotGit(segments[0] + "/" + segments[1])
}

func stripDotGit(input string) (string, bool) {
	value := strings.TrimSpace(input)
	for strings.HasSuffix(value, ".git") {
		value = strings.TrimSuffix(value, ".git")
	}
	return value, strings.Contains(value, "/")
}
