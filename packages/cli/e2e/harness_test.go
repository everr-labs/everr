// Package e2e runs the built everr binary the way users do. TestMain builds
// it once with whatever assets scripts/stage-go-assets.ts staged.
package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

var binary string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "everr-e2e-")
	if err != nil {
		panic(err)
	}
	binary = filepath.Join(dir, "everr")
	if prebuilt := os.Getenv("EVERR_E2E_BINARY"); prebuilt != "" {
		binary = prebuilt
	} else {
		build := exec.Command("go", "build", "-o", binary, "./cmd/everr")
		build.Dir = ".."
		build.Stdout, build.Stderr = os.Stdout, os.Stderr
		if err := build.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "build everr: %v\n", err)
			os.Exit(1)
		}
	}
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

// Env is an isolated HOME and config directory for one test.
type Env struct {
	t         *testing.T
	HomeDir   string
	ConfigDir string
	extraEnv  []string
}

func NewEnv(t *testing.T) *Env {
	t.Helper()
	home := filepath.Join(t.TempDir(), "home")
	config := platformConfigDir(home)
	for _, dir := range []string{home, config} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return &Env{t: t, HomeDir: home, ConfigDir: config}
}

// Setenv adds an environment variable to every command this Env runs.
func (e *Env) Setenv(key, value string) *Env {
	e.extraEnv = append(e.extraEnv, key+"="+value)
	return e
}

// WithAPIBaseURL points API calls at a test server.
func (e *Env) WithAPIBaseURL(url string) *Env {
	return e.Setenv("EVERR_API_BASE_URL_FOR_TESTS", url)
}

func (e *Env) WithReleaseMetadataURL(url string) *Env {
	return e.Setenv("EVERR_RELEASE_METADATA_URL_FOR_TESTS", url)
}

// Command builds an everr invocation running in HomeDir.
func (e *Env) Command(args ...string) *exec.Cmd {
	cmd := exec.Command(binary, args...)
	cmd.Dir = e.HomeDir
	env := []string{}
	for _, kv := range os.Environ() {
		key, _, _ := strings.Cut(kv, "=")
		switch key {
		case "EVERR_CONFIG_DIR", "EVERR_API_KEY", "EVERR_API_TOKEN", "EVERR_API_URL",
			"HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME":
			continue
		}
		env = append(env, kv)
	}
	env = append(env,
		"HOME="+e.HomeDir,
		"XDG_CONFIG_HOME="+e.ConfigDir,
		"XDG_DATA_HOME="+filepath.Join(e.HomeDir, ".local", "share"),
	)
	cmd.Env = append(env, e.extraEnv...)
	return cmd
}

// Result is a finished invocation.
type Result struct {
	Stdout string
	Stderr string
	Code   int
}

// Run runs everr with args and waits up to 30s.
func (e *Env) Run(args ...string) Result {
	e.t.Helper()
	return RunCmd(e.t, e.Command(args...))
}

// RunCmd runs a prepared command and waits up to 30s.
func RunCmd(t *testing.T, cmd *exec.Cmd) Result {
	t.Helper()
	var stdout, stderr bytes.Buffer
	if cmd.Stdout == nil {
		cmd.Stdout = &stdout
	}
	if cmd.Stderr == nil {
		cmd.Stderr = &stderr
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start everr: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		_ = cmd.Process.Kill()
		<-done
		t.Fatalf("everr %v timed out\nstdout:\n%s\nstderr:\n%s", cmd.Args[1:], stdout.String(), stderr.String())
	}
	return Result{Stdout: stdout.String(), Stderr: stderr.String(), Code: cmd.ProcessState.ExitCode()}
}

// Success fails the test unless the command exited 0.
func (r Result) Success(t *testing.T) Result {
	t.Helper()
	if r.Code != 0 {
		t.Fatalf("exit %d, want 0\nstdout:\n%s\nstderr:\n%s", r.Code, r.Stdout, r.Stderr)
	}
	return r
}

// Failure fails the test unless the command exited with code.
func (r Result) Failure(t *testing.T, code int) Result {
	t.Helper()
	if r.Code != code {
		t.Fatalf("exit %d, want %d\nstdout:\n%s\nstderr:\n%s", r.Code, code, r.Stdout, r.Stderr)
	}
	return r
}

// JSON decodes stdout.
func (r Result) JSON(t *testing.T) any {
	t.Helper()
	var value any
	if err := json.Unmarshal([]byte(r.Stdout), &value); err != nil {
		t.Fatalf("stdout is not JSON: %v\n%s", err, r.Stdout)
	}
	return value
}

func (e *Env) SessionPath() string {
	return filepath.Join(e.ConfigDir, "everr", "session-dev.json")
}

// WriteSession saves a signed-in session the way `everr cloud login` does.
func (e *Env) WriteSession(apiBaseURL, token string) {
	e.t.Helper()
	data, err := json.MarshalIndent(map[string]any{
		"session": map[string]string{"api_base_url": apiBaseURL, "token": token},
	}, "", "  ")
	if err != nil {
		e.t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(e.SessionPath()), 0o755); err != nil {
		e.t.Fatal(err)
	}
	if err := os.WriteFile(e.SessionPath(), data, 0o600); err != nil {
		e.t.Fatal(err)
	}
}

func (e *Env) UpdateCachePath() string {
	return filepath.Join(platformDataLocalDir(e.HomeDir), "everr", "cli-update-check-dev.json")
}

func (e *Env) TelemetryDir() string {
	return filepath.Join(platformDataLocalDir(e.HomeDir), "everr", "telemetry-dev")
}

// InitGitRepo creates a repository under HomeDir with one commit on branch
// and an origin remote.
func (e *Env) InitGitRepo(relativeDir, branch, remote string) string {
	e.t.Helper()
	dir := filepath.Join(e.HomeDir, relativeDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		e.t.Fatal(err)
	}
	git := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "HOME="+e.HomeDir)
		if out, err := cmd.CombinedOutput(); err != nil {
			e.t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	git("init")
	git("config", "user.email", "tests@everr.dev")
	git("config", "user.name", "Everr Tests")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# test repo\n"), 0o644); err != nil {
		e.t.Fatal(err)
	}
	git("add", "README.md")
	git("commit", "-m", "init")
	git("checkout", "-b", branch)
	git("remote", "add", "origin", remote)
	return dir
}

func platformConfigDir(home string) string {
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support")
	}
	return filepath.Join(home, ".config")
}

func platformDataLocalDir(home string) string {
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support")
	}
	return filepath.Join(home, ".local", "share")
}
