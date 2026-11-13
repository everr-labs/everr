package upgrade

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/spf13/cobra"

	"github.com/everr-labs/everr/packages/cli/internal/build"
	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
	"github.com/everr-labs/everr/packages/cli/internal/updatenotice"
)

const (
	downloadPathPrefix     = "/everr-app"
	metadataTimeout        = 10 * time.Second
	downloadConnectTimeout = 10 * time.Second
	downloadReadTimeout    = 30 * time.Second
	fallbackCommand        = "curl -fsSL https://everr.dev/upgrade.sh | bash"
	// DownloadBaseURLOverrideEnv points debug builds at a test artifact server.
	DownloadBaseURLOverrideEnv = "EVERR_DOWNLOAD_BASE_URL_FOR_TESTS"
)

func NewCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "upgrade",
		Short: "Upgrade the Everr CLI and bundled local UI to the latest version",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return run(cmd.Context(), cmd.OutOrStdout())
		},
	}
	cmdutil.Positionals(cmd)
	cmdutil.SetHumanStdout(cmd, cmdutil.HumanAlways)
	return cmd
}

func run(ctx context.Context, out io.Writer) error {
	metadata, err := updatenotice.FetchReleaseMetadata(ctx, metadataTimeout)
	if err != nil {
		return err
	}
	current, err := semver.StrictNewVersion(build.Version())
	if err != nil {
		return fmt.Errorf("parse current CLI version: %w", err)
	}
	latest, err := semver.StrictNewVersion(metadata.Version)
	if err != nil {
		return fmt.Errorf("parse latest CLI version %q: %w", metadata.Version, err)
	}
	if !latest.GreaterThan(current) {
		fmt.Fprintf(out, "Already up to date (v%s)\n", current)
		return nil
	}

	binaryName, err := ReleaseBinaryName()
	if err != nil {
		return err
	}
	base, err := downloadBaseURL()
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "Downloading Everr CLI v%s...\n", latest)

	checksum, err := downloadBytes(ctx, base+"/"+binaryName+".sha256")
	if err != nil {
		return err
	}
	binary, err := downloadBytes(ctx, base+"/"+binaryName)
	if err != nil {
		return err
	}
	if err := verifySHA256(binary, checksum); err != nil {
		return err
	}
	if err := replaceCurrentExe(binary); err != nil {
		return err
	}
	fmt.Fprintf(out, "Upgraded everr v%s → v%s\n", current, latest)
	return nil
}

// ReleaseBinaryName is the release artifact for this platform, with the same
// mapping as packages/docs/public/install.sh.
func ReleaseBinaryName() (string, error) {
	return releaseBinaryName(runtime.GOOS, runtime.GOARCH)
}

func releaseBinaryName(goos, goarch string) (string, error) {
	switch goos + "/" + goarch {
	case "darwin/arm64":
		return "everr", nil
	case "linux/arm64":
		return "everr-linux-arm64", nil
	case "linux/amd64":
		return "everr-linux-x86_64", nil
	}
	return "", fmt.Errorf("everr upgrade does not support %s %s. Use: %s", platformOS(goos), platformArch(goarch), fallbackCommand)
}

// The previous CLI named platforms the Rust way in this message.
func platformOS(goos string) string {
	if goos == "darwin" {
		return "macos"
	}
	return goos
}

func platformArch(goarch string) string {
	switch goarch {
	case "amd64":
		return "x86_64"
	case "arm64":
		return "aarch64"
	}
	return goarch
}

// Debug builds refuse to hit the production artifacts: replacing a dev
// binary with a release binary silently corrupts the dev workflow. Tests point
// this at a local server via the override variable.
func downloadBaseURL() (string, error) {
	if !build.Release {
		url, ok := build.DebugOverride(DownloadBaseURLOverrideEnv)
		if !ok {
			return "", fmt.Errorf("refusing to self-update a debug build; set %s or use a release binary", DownloadBaseURLOverrideEnv)
		}
		return url, nil
	}
	return build.DefaultDocsBaseURL + downloadPathPrefix, nil
}

var downloadClient = &http.Client{
	Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: downloadConnectTimeout}).DialContext,
		TLSHandshakeTimeout:   downloadConnectTimeout,
		ResponseHeaderTimeout: downloadReadTimeout,
	},
}

func downloadBytes(ctx context.Context, url string) ([]byte, error) {
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	resp, err := downloadClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("GET %s: HTTP status %s", url, resp.Status)
	}
	body, err := io.ReadAll(&idleTimeoutReader{r: resp.Body, cancel: cancel})
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", url, err)
	}
	return body, nil
}

// idleTimeoutReader aborts a download that stalls for downloadReadTimeout
// between reads, without capping how long a slow but steady download takes.
type idleTimeoutReader struct {
	r      io.Reader
	cancel context.CancelCauseFunc
	timer  *time.Timer
}

func (i *idleTimeoutReader) Read(p []byte) (int, error) {
	if i.timer == nil {
		i.timer = time.AfterFunc(downloadReadTimeout, func() {
			i.cancel(errors.New("download stalled"))
		})
	} else {
		i.timer.Reset(downloadReadTimeout)
	}
	n, err := i.r.Read(p)
	if err != nil {
		i.timer.Stop()
	}
	return n, err
}

// The checksum file is `<hex>  <filename>`, as produced by `shasum -a 256`.
func verifySHA256(binary, checksumFile []byte) error {
	fields := strings.Fields(string(checksumFile))
	if len(fields) == 0 {
		return errors.New("checksum file is empty")
	}
	expected := strings.ToLower(fields[0])
	sum := sha256.Sum256(binary)
	actual := hex.EncodeToString(sum[:])
	if actual != expected {
		return fmt.Errorf("checksum mismatch for downloaded binary: expected %s, got %s", expected, actual)
	}
	return nil
}

func replaceCurrentExe(binary []byte) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve current executable path: %w", err)
	}
	return replaceFile(exe, binary)
}

func replaceFile(path string, contents []byte) error {
	dir := filepath.Dir(path)
	// Staged in the same directory so the final rename is atomic (same
	// filesystem) and never leaves a truncated binary in place.
	staged, err := os.CreateTemp(dir, ".tmp")
	if err != nil {
		return fmt.Errorf("create temp file in %s: %w", dir, err)
	}
	stagedPath := staged.Name()
	committed := false
	defer func() {
		if !committed {
			_ = staged.Close()
			_ = os.Remove(stagedPath)
		}
	}()
	if _, err := staged.Write(contents); err != nil {
		return fmt.Errorf("write downloaded binary: %w", err)
	}
	// fsync before the rename: without it a crash right after can leave a
	// truncated binary at the final path, bricking the CLI.
	if err := staged.Sync(); err != nil {
		return fmt.Errorf("sync downloaded binary: %w", err)
	}
	if err := staged.Close(); err != nil {
		return fmt.Errorf("write downloaded binary: %w", err)
	}
	if err := os.Chmod(stagedPath, 0o755); err != nil {
		return fmt.Errorf("set executable permissions: %w", err)
	}
	if err := os.Rename(stagedPath, path); err != nil {
		return fmt.Errorf("failed to replace %s (check permissions, or run: %s): %w", path, fallbackCommand, err)
	}
	committed = true
	return nil
}
