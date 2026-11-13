package git

import "testing"

func TestRemoteSlugCollapsesEquivalentCloneURLs(t *testing.T) {
	for _, remote := range []string{
		"git@github.com:Everr-Labs/everr.git",
		"https://github.com/everr-labs/everr.git",
		"https://user:pass@github.com/everr-labs/everr",
		"ssh://git@github.com:2222/everr-labs/everr.git/",
		"git://github.com/everr-labs/everr",
	} {
		if got, ok := NormalizeRemoteSlug(remote); !ok || got != "github.com/everr-labs/everr" {
			t.Errorf("NormalizeRemoteSlug(%q) = %q, %v", remote, got, ok)
		}
	}
}

func TestRemoteSlugKeepsNestedPathSegments(t *testing.T) {
	got, _ := NormalizeRemoteSlug("https://gitlab.example.com/group/subgroup/repo.git")
	if got != "gitlab.example.com/group/subgroup/repo" {
		t.Errorf("got %q", got)
	}
}

func TestRemoteSlugRejectsHostlessRemotes(t *testing.T) {
	for _, remote := range []string{
		"/srv/git/repo.git",
		"../sibling/repo",
		"file:///srv/git/repo.git",
		"https://github.com",
		"",
	} {
		if got, ok := NormalizeRemoteSlug(remote); ok {
			t.Errorf("NormalizeRemoteSlug(%q) = %q, want none", remote, got)
		}
	}
}

func TestNormalizeBranchNameStripsLocalRefPrefix(t *testing.T) {
	if got := NormalizeBranchName("refs/heads/feature/refactor"); got != "feature/refactor" {
		t.Errorf("got %q", got)
	}
	if got := NormalizeBranchName("HEAD"); got != "HEAD" {
		t.Errorf("got %q", got)
	}
}

func TestParseRepoFromRemoteSupportsSSHAndHTTPURLs(t *testing.T) {
	for _, remote := range []string{
		"git@github.com:everr-labs/everr.git",
		"https://github.com/everr-labs/everr.git",
		"http://github.com/everr-labs/everr",
	} {
		if got, ok := ParseRepoFromRemoteURL(remote); !ok || got != "everr-labs/everr" {
			t.Errorf("ParseRepoFromRemoteURL(%q) = %q, %v", remote, got, ok)
		}
	}
}

func TestParseRepoFromRemoteRejectsInvalidValues(t *testing.T) {
	for _, remote := range []string{"https://github.com/everr-app", "everr-app", ""} {
		if got, ok := ParseRepoFromRemoteURL(remote); ok {
			t.Errorf("ParseRepoFromRemoteURL(%q) = %q, want none", remote, got)
		}
	}
}
