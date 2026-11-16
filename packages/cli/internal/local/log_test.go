package local

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const captureChildEnv = "EVERR_TEST_CAPTURE_CHILD"

// runCaptured runs the named test in a child process that is a detached
// supervisor logging to a fresh directory. The test's body runs there when
// it sees inCaptureChild.
func runCaptured(t *testing.T, name string) (stdout, log string, err error) {
	t.Helper()
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^"+name+"$")
	cmd.Env = append(os.Environ(),
		captureChildEnv+"=1",
		backgroundInstanceIDEnv+"=test",
		"EVERR_LOCAL_LOG_DIR="+dir,
	)
	out, err := cmd.Output()
	written, _ := os.ReadFile(filepath.Join(dir, "local.log"))
	return string(out), string(written), err
}

func inCaptureChild() bool {
	return os.Getenv(captureChildEnv) != ""
}

func TestAPanicInTheCapturedProcessReachesTheLog(t *testing.T) {
	if inCaptureChild() {
		if _, _, err := StartLogCapture(); err != nil {
			os.Exit(1)
		}
		panic("supervisor crashed")
	}
	_, log, err := runCaptured(t, "TestAPanicInTheCapturedProcessReachesTheLog")
	if exit, ok := errors.AsType[*exec.ExitError](err); !ok || exit.ExitCode() != 2 {
		t.Fatalf("crashing process: %v", err)
	}
	if !strings.Contains(log, "panic: supervisor crashed") {
		t.Fatalf("local.log = %q", log)
	}
}

func TestStoppingTheCaptureRestoresStdout(t *testing.T) {
	if inCaptureChild() {
		stop, _, err := StartLogCapture()
		if err != nil {
			os.Exit(1)
		}
		fmt.Println("captured")
		stop()
		fmt.Println("restored")
		return
	}
	stdout, log, err := runCaptured(t, "TestStoppingTheCaptureRestoresStdout")
	if err != nil {
		t.Fatal(err)
	}
	if log != "captured\n" || !strings.Contains(stdout, "restored") || strings.Contains(stdout, "captured") {
		t.Fatalf("stdout = %q, local.log = %q", stdout, log)
	}
}

// capturedLog opens the log at path with a descriptor standing in for
// stdout, and returns a func that writes to that descriptor as the
// supervisor's output does.
func capturedLog(t *testing.T, path string) (*rotatingLog, func(data []byte)) {
	t.Helper()
	log, err := openRotatingLog(path)
	if err != nil {
		t.Fatal(err)
	}
	fd, err := unix.Open(os.DevNull, unix.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { unix.Close(fd) })
	log.fds = []int{fd}
	if err := log.redirect(log.file); err != nil {
		t.Fatal(err)
	}
	return log, func(data []byte) {
		t.Helper()
		if n, err := unix.Write(fd, data); err != nil || n != len(data) {
			t.Fatalf("wrote %d of %d bytes: %v", n, len(data), err)
		}
	}
}

func TestRotationBoundsStoragePreservesOrderAndExcludesCompetingWriters(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "local.log")
	log, emit := capturedLog(t, path)
	if _, err := openRotatingLog(path); err == nil {
		t.Fatal("second writer opened the log")
	}
	emit([]byte("short"))
	if err := log.rotateIfFull(); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(path); string(got) != "short" {
		t.Fatalf("a log below the limit was rotated: %q", got)
	}
	for b := byte('a'); b <= 'f'; b++ {
		emit(bytes.Repeat([]byte{b}, maxLogBytes))
		if err := log.rotateIfFull(); err != nil {
			t.Fatal(err)
		}
	}
	emit([]byte("latest"))
	if got, _ := os.ReadFile(path); string(got) != "latest" {
		t.Fatalf("current log = %q", got)
	}
	for index, b := range []byte("fed") {
		got, _ := os.ReadFile(fmt.Sprintf("%s.%d", path, index+1))
		if !bytes.Equal(got, bytes.Repeat([]byte{b}, maxLogBytes)) {
			t.Fatalf("backup %d is wrong", index+1)
		}
	}
	if entries, _ := os.ReadDir(dir); len(entries) != logBackups+2 {
		t.Fatalf("%d files in the log directory", len(entries))
	}
	log.Close()
	log, emit = capturedLog(t, path)
	emit([]byte(" again"))
	log.Close()
	if tail, _ := logTail(path); tail != "latest again" {
		t.Fatalf("tail = %q", tail)
	}
}

func TestFailedRotationKeepsTheLogAndItsBackups(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local.log")
	log, emit := capturedLog(t, path)
	defer log.Close()
	emit(bytes.Repeat([]byte("a"), maxLogBytes))
	if err := log.rotateIfFull(); err != nil {
		t.Fatal(err)
	}
	emit(bytes.Repeat([]byte("b"), maxLogBytes))
	// The new log cannot be created while a directory holds its name.
	if err := os.Mkdir(path+".next", 0o700); err != nil {
		t.Fatal(err)
	}
	if err := log.rotateIfFull(); err == nil {
		t.Fatal("rotation succeeded without a place for the new log")
	}
	emit([]byte("c"))
	if got, _ := os.ReadFile(path); !bytes.Equal(got, append(bytes.Repeat([]byte("b"), maxLogBytes), 'c')) {
		t.Fatalf("current log has %d bytes", len(got))
	}
	if got, _ := os.ReadFile(path + ".1"); !bytes.Equal(got, bytes.Repeat([]byte("a"), maxLogBytes)) {
		t.Fatal("backup was lost")
	}
	if err := os.Remove(path + ".next"); err != nil {
		t.Fatal(err)
	}
	if err := log.rotateIfFull(); err != nil {
		t.Fatal(err)
	}
	if info, _ := os.Stat(path + ".1"); info.Size() != maxLogBytes+1 {
		t.Fatalf("rotated backup has %d bytes", info.Size())
	}
}

func TestOversizedExistingLogKeepsRecentOutputAndNewLogsArePrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "logs", "local.log")
	log, err := openRotatingLog(path)
	if err != nil {
		t.Fatal(err)
	}
	for file, want := range map[string]os.FileMode{filepath.Dir(path): 0o700, path: 0o600} {
		if info, _ := os.Stat(file); info.Mode().Perm() != want {
			t.Fatalf("%s mode = %v", file, info.Mode().Perm())
		}
	}
	log.Close()
	if err := os.WriteFile(path, append(bytes.Repeat([]byte("x"), maxLogBytes+100), "recent"...), 0o600); err != nil {
		t.Fatal(err)
	}
	log, emit := capturedLog(t, path)
	defer log.Close()
	if info, _ := os.Stat(path); info.Size() != maxLogBytes {
		t.Fatalf("size = %d", info.Size())
	}
	if tail, _ := logTail(path); !strings.HasSuffix(tail, "recent") {
		t.Fatal("recent output was dropped")
	}
	if err := log.rotateIfFull(); err != nil {
		t.Fatal(err)
	}
	emit([]byte("new output"))
	if info, _ := os.Stat(path + ".1"); info.Size() != maxLogBytes {
		t.Fatalf("backup size = %d", info.Size())
	}
	if got, _ := os.ReadFile(path); string(got) != "new output" {
		t.Fatalf("current log = %q", got)
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Fatalf("rotated log mode = %v", info.Mode().Perm())
	}
}
