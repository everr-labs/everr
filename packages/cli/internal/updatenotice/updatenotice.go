// Package updatenotice tells users when a newer CLI release exists.
package updatenotice

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/spf13/cobra"

	"github.com/everr-labs/everr/packages/cli/internal/build"
)

const (
	checkInterval         = 24 * time.Hour
	fetchTimeout          = 750 * time.Millisecond
	releaseMetadataPath   = "/everr-app/release-metadata.json"
	upgradeCommand        = "everr upgrade"
	releaseMetadataURLEnv = "EVERR_RELEASE_METADATA_URL_FOR_TESTS"
	// chrono's to_rfc3339 layout, which the previous CLI wrote.
	timestampLayout = "2006-01-02T15:04:05.999999999-07:00"
)

// ReleaseMetadata is the published CLI release metadata. Unknown fields are
// ignored.
type ReleaseMetadata struct {
	Version string `json:"version"`
}

type cacheFile struct {
	LastCheckedAt   string `json:"last_checked_at"`
	LatestVersion   string `json:"latest_version"`
	UpdateAvailable bool   `json:"update_available"`
}

// MaybePrint prints an upgrade notice before cmd runs, when one is due.
func MaybePrint(ctx context.Context, cmd *cobra.Command) {
	status, err := check(ctx)
	if err != nil || !status.UpdateAvailable {
		return
	}
	out := cmd.OutOrStdout()
	fmt.Fprintf(out, "A new version is available: %s\n", status.LatestVersion)
	fmt.Fprintf(out, "Run: %s\n", upgradeCommand)
}

func check(ctx context.Context) (cacheFile, error) {
	path, err := cachePath()
	if err != nil {
		return cacheFile{}, err
	}
	cached, hasCache := readCache(path)
	if hasCache {
		current := cached.forCurrentVersion()
		if current.UpdateAvailable || !isStale(current, time.Now()) {
			return current, nil
		}
	}

	metadata, err := FetchReleaseMetadata(ctx, fetchTimeout)
	if err != nil {
		if hasCache {
			return cached.forCurrentVersion(), nil
		}
		return cacheFile{}, err
	}
	cache := cacheFile{
		LastCheckedAt:   time.Now().UTC().Format(timestampLayout),
		LatestVersion:   metadata.Version,
		UpdateAvailable: IsNewer(metadata.Version, build.Version()),
	}
	_ = writeCache(path, cache)
	return cache, nil
}

func (c cacheFile) forCurrentVersion() cacheFile {
	c.UpdateAvailable = IsNewer(c.LatestVersion, build.Version())
	return c
}

func readCache(path string) (cacheFile, bool) {
	body, err := os.ReadFile(path)
	if err != nil {
		return cacheFile{}, false
	}
	var cache cacheFile
	if err := json.Unmarshal(body, &cache); err != nil {
		return cacheFile{}, false
	}
	return cache, true
}

func writeCache(path string, cache cacheFile) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(path), err)
	}
	body, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, body, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func isStale(cache cacheFile, now time.Time) bool {
	lastChecked, err := time.Parse(time.RFC3339Nano, cache.LastCheckedAt)
	if err != nil {
		return true
	}
	elapsed := now.Sub(lastChecked)
	return elapsed < 0 || elapsed >= checkInterval
}

// FetchReleaseMetadata downloads the latest release metadata.
func FetchReleaseMetadata(ctx context.Context, timeout time.Duration) (ReleaseMetadata, error) {
	url := releaseMetadataURL()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ReleaseMetadata{}, fmt.Errorf("GET %s: %w", url, err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ReleaseMetadata{}, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return ReleaseMetadata{}, fmt.Errorf("GET %s: HTTP status %s", url, resp.Status)
	}
	var metadata ReleaseMetadata
	if err := json.NewDecoder(resp.Body).Decode(&metadata); err != nil {
		return ReleaseMetadata{}, fmt.Errorf("parse %s: %w", url, err)
	}
	return metadata, nil
}

func releaseMetadataURL() string {
	if url, ok := build.DebugOverride(releaseMetadataURLEnv); ok {
		return url
	}
	return build.DefaultDocsBaseURL + releaseMetadataPath
}

func cachePath() (string, error) {
	base, err := build.DataLocalDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, build.SessionNamespace, cacheFileName()), nil
}

func cacheFileName() string {
	if build.Release {
		return "cli-update-check.json"
	}
	return "cli-update-check-dev.json"
}

// IsNewer reports whether latest is a strictly greater semver than current.
// Unparseable versions never count as newer.
func IsNewer(latest, current string) bool {
	l, err := semver.StrictNewVersion(latest)
	if err != nil {
		return false
	}
	c, err := semver.StrictNewVersion(current)
	if err != nil {
		return false
	}
	return l.GreaterThan(c)
}
