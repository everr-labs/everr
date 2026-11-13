// Package git reads repository context (repo, branch, commits, remotes) by
// running the git binary.
package git

import (
	"os/exec"
	"strings"
)

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

// NormalizeRemoteSlug turns a remote URL into the repoid slug
// `host/owner/repo`: scheme, credentials, port, one trailing `.git`, and
// trailing slashes are dropped and the result is lowercased, so the ssh,
// scp-like, and https URLs of one repository collapse to one identity.
// Nested paths (GitLab subgroups) keep their segments. Local-path and
// `file://` remotes have no host and report false.
//
// The result is an identity key, so it keeps the host and case-folds:
// `github.com/a/b` and `gitlab.com/a/b` must stay distinct while casing
// variants must not.
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
