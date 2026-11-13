package local

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"

	"github.com/everr-labs/everr/packages/cli/internal/build"
)

// backgroundInstanceIDEnv marks the detached supervisor process and carries
// the instance ID its parent waits for.
const backgroundInstanceIDEnv = "EVERR_LOCAL_BACKGROUND_INSTANCE_ID"

// Lifetime holds the telemetry directory lock. main releases it only after
// command telemetry and log capture finish, so `local stop` returning means
// the supervisor is completely done.
type Lifetime struct {
	lock *os.File
}

func (l *Lifetime) acquire(telemetryDir string) error {
	lock, err := lockTelemetryDir(telemetryDir)
	if err != nil {
		return err
	}
	l.lock = lock
	return nil
}

func (l *Lifetime) Release() {
	if l.lock != nil {
		l.lock.Close()
		l.lock = nil
	}
}

func newInstanceID() string {
	return fmt.Sprintf("%x-%x", os.Getpid(), time.Now().UnixNano())
}

func lockTelemetryDir(telemetryDir string) (*os.File, error) {
	if err := os.MkdirAll(telemetryDir, 0o755); err != nil {
		return nil, fmt.Errorf("create telemetry directory: %w", err)
	}
	file, err := os.OpenFile(filepath.Join(telemetryDir, "local.lock"), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		file.Close()
		return nil, busyError{fmt.Errorf("cannot start Everr: another instance is using this telemetry directory: %w", err)}
	}
	return file, nil
}

// busyExitCode is the exit status of a background start that lost a lock to
// another Everr process, so the parent waits for that instance instead.
const busyExitCode = 3

// busyError marks a lock held by another Everr process.
type busyError struct{ error }

func (e busyError) Unwrap() error { return e.error }

// ExitCode returns the process exit status for a command that failed with
// err. A background start that lost a lock exits with busyExitCode.
func ExitCode(err error, code int) int {
	if _, background := os.LookupEnv(backgroundInstanceIDEnv); background && errors.As(err, new(busyError)) {
		return busyExitCode
	}
	return code
}

// startDetached re-runs `local start` in a new session and returns once that
// instance is ready, or reports why it never became ready.
func startDetached(ctx context.Context) error {
	path, err := logPath()
	if err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	instanceID := newInstanceID()
	cmd := exec.Command(exe, "local", "start", "--no-open")
	cmd.Env = append(os.Environ(), backgroundInstanceIDEnv+"="+instanceID)
	// The child must leave the terminal's session so closing the terminal
	// does not stop it.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	// A plain pipe rather than StderrPipe: Wait closes StderrPipe's reader,
	// which would race the copy below.
	stderr, stderrWriter, err := os.Pipe()
	if err != nil {
		return err
	}
	defer stderr.Close()
	cmd.Stderr = stderrWriter
	err = cmd.Start()
	stderrWriter.Close()
	if err != nil {
		return fmt.Errorf("start Everr in the background: %w", err)
	}
	// The child redirects its stderr into the log right away, so this pipe
	// only carries output from before that point and closes soon after.
	var early bytes.Buffer
	copied := make(chan struct{})
	go func() {
		_, _ = io.Copy(&early, io.LimitReader(stderr, 8192))
		close(copied)
	}()
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	deadline := time.Now().Add(20 * time.Second)
	// lost is set when the child exited because a concurrent start holds the
	// instance's locks; any instance that becomes ready then counts.
	lost := false
	var failure string
	for {
		status := Inspect(ctx)
		if identity, ok := status.RunningInstance(); ok && (identity.InstanceID == instanceID || lost) {
			return nil
		}
		select {
		case waitErr := <-exited:
			switch {
			case waitErr == nil:
				// It found a running instance, or a concurrent stop ended it.
				return nil
			case cmd.ProcessState.ExitCode() == busyExitCode:
				lost = true
			default:
				failure = "background process exited: " + exitDescription(cmd.ProcessState)
			}
		default:
			if time.Now().After(deadline) {
				failure = "background startup did not become ready"
				terminate(cmd.Process, exited)
			}
		}
		if failure != "" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	<-copied
	output := early.String()
	if output == "" {
		output, _ = logTail(path)
	}
	return fmt.Errorf("%s; log: %s\n%s", failure, path, strings.TrimSpace(output))
}

func exitDescription(state *os.ProcessState) string {
	if state == nil {
		return "unknown status"
	}
	if code := state.ExitCode(); code >= 0 {
		return fmt.Sprintf("exit status: %d", code)
	}
	return state.String()
}

// terminate stops a child with SIGTERM, then SIGKILL after 3s. exited
// receives the child's Wait result.
func terminate(process *os.Process, exited <-chan error) {
	if err := process.Signal(syscall.SIGTERM); err != nil {
		if errors.Is(err, os.ErrProcessDone) {
			return
		}
		_ = process.Kill()
	}
	select {
	case <-exited:
	case <-time.After(3 * time.Second):
		fmt.Fprintln(os.Stderr, "[collector] did not exit within 3s of SIGTERM; hard-killing")
		_ = process.Kill()
		<-exited
	}
}

// waitUntilStarted lets an instance that is still starting finish, so stop
// can then shut it down.
func waitUntilStarted(ctx context.Context) (Status, error) {
	deadline := time.Now().Add(30 * time.Second)
	for {
		status := Inspect(ctx)
		if !status.starting() || time.Now().After(deadline) {
			return status, nil
		}
		select {
		case <-ctx.Done():
			return status, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

type stopLocalArgs struct {
	InstanceID string `json:"instance_id"`
}

type stopLocalResponse struct {
	LockPath string `json:"lock_path"`
}

func stop(ctx context.Context, w io.Writer) error {
	status, err := waitUntilStarted(ctx)
	if err != nil {
		return err
	}
	if status.Stopped() {
		dir, err := build.TelemetryDir()
		if err != nil {
			return err
		}
		if err := waitForShutdown(ctx, filepath.Join(dir, "local.lock")); err != nil {
			return err
		}
		fmt.Fprintln(w, "Everr is already stopped")
		return nil
	}
	if status.UI.State != StateRunning {
		return fmt.Errorf("cannot stop Everr: local UI is %s", status.UI.State.Description())
	}
	identity := status.UI.Identity
	if status.Collector.State == StateRunning && status.Collector.Identity.InstanceID != identity.InstanceID {
		return errors.New("cannot stop Everr: collector and UI do not belong to the same instance")
	}

	origin := build.LocalUIOrigin()
	body, _ := json.Marshal(stopLocalArgs{InstanceID: identity.InstanceID})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+"/api/commands/stop_local", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Origin", origin)
	req.Header.Set("X-Everr-Local", "1")
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: nil}}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request local shutdown: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read local shutdown response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("local shutdown failed (%s): %s", resp.Status, respBody)
	}
	var shutdown stopLocalResponse
	if err := json.Unmarshal(respBody, &shutdown); err != nil {
		return fmt.Errorf("read local shutdown response: %w", err)
	}
	if err := waitForShutdown(ctx, shutdown.LockPath); err != nil {
		return err
	}
	fmt.Fprintln(w, "Everr stopped")
	return nil
}

func waitForShutdown(ctx context.Context, lockPath string) error {
	deadline := time.Now().Add(10 * time.Second)
	for {
		if Inspect(ctx).Stopped() {
			released, err := lockReleased(lockPath)
			if err != nil {
				return err
			}
			if released {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("local shutdown did not complete; check `%s local status`", build.CommandName())
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func lockReleased(path string) (bool, error) {
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("open local supervisor lock: %w", err)
	}
	defer file.Close()
	switch err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB); {
	case err == nil:
		return true, nil
	case errors.Is(err, unix.EWOULDBLOCK):
		return false, nil
	default:
		return false, fmt.Errorf("check local supervisor shutdown: %w", err)
	}
}
