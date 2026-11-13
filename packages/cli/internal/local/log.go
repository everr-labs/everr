package local

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"golang.org/x/sys/unix"

	"github.com/everr-labs/everr/packages/cli/internal/build"
)

const (
	maxLogBytes = 5 * 1024 * 1024
	logBackups  = 3
)

// logPath is the detached supervisor's log file.
func logPath() (string, error) {
	if dir := os.Getenv("EVERR_LOCAL_LOG_DIR"); dir != "" {
		return filepath.Join(dir, "local.log"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory for local logs: %w", err)
	}
	return filepath.Join(defaultLogDir(home, os.Getenv("XDG_STATE_HOME"), runtime.GOOS == "darwin"), "local.log"), nil
}

func defaultLogDir(home, state string, macos bool) string {
	app := "everr"
	if !build.Release {
		app = "everr-dev"
	}
	if macos {
		return filepath.Join(home, "Library", "Logs", app)
	}
	if !filepath.IsAbs(state) {
		state = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(state, app)
}

// StartLogCapture redirects stdout and stderr into the rotating local log
// when this process is the detached supervisor, so output from the
// supervisor, the in-process collector, and the Go runtime all land there.
// stop restores the original descriptors and waits for the log to be
// written.
func StartLogCapture() (stop func(), captured bool, err error) {
	if _, ok := os.LookupEnv(backgroundInstanceIDEnv); !ok {
		return func() {}, false, nil
	}
	path, err := logPath()
	if err != nil {
		return nil, false, err
	}
	log, err := openRotatingLog(path)
	if err != nil {
		return nil, false, err
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		log.Close()
		return nil, false, err
	}
	saved := [2]int{}
	for i, fd := range []int{1, 2} {
		if saved[i], err = unix.Dup(fd); err != nil {
			log.Close()
			return nil, false, err
		}
	}
	if err := unix.Dup2(int(writer.Fd()), 1); err != nil {
		log.Close()
		return nil, false, err
	}
	if err := unix.Dup2(int(writer.Fd()), 2); err != nil {
		_ = unix.Dup2(saved[0], 1)
		log.Close()
		return nil, false, err
	}
	writer.Close()

	done := make(chan error, 1)
	go func() {
		_, err := io.Copy(log, reader)
		if err != nil {
			// Without a reader, writes to fds 1 and 2 would block once the
			// pipe fills, hanging the whole process.
			_, _ = io.Copy(io.Discard, reader)
		}
		done <- errors.Join(err, log.Close())
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			// Restoring fds 1 and 2 closes the pipe's last write ends, so the
			// copy sees EOF once everything written so far is in the log.
			for i, fd := range []int{1, 2} {
				_ = unix.Dup2(saved[i], fd)
				_ = unix.Close(saved[i])
			}
			if err := <-done; err != nil {
				fmt.Fprintln(os.Stderr, "could not finish writing the local supervisor log")
			}
		})
	}, true, nil
}

// rotatingLog keeps at most maxLogBytes per file plus logBackups rotated
// copies, and holds a lock so two supervisors never write one log.
type rotatingLog struct {
	path string
	file *os.File
	size int64
	lock *os.File
}

func openRotatingLog(path string) (*rotatingLog, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create local log directory: %w", err)
	}
	lock, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		lock.Close()
		return nil, fmt.Errorf("another instance is writing to this local log directory; use EVERR_LOCAL_LOG_DIR for a separate instance: %w", err)
	}
	file, err := openLogFile(path)
	if err != nil {
		lock.Close()
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		lock.Close()
		return nil, err
	}
	size := info.Size()
	if size > maxLogBytes {
		tail := make([]byte, maxLogBytes)
		if _, err := file.ReadAt(tail, size-maxLogBytes); err != nil && !errors.Is(err, io.EOF) {
			file.Close()
			lock.Close()
			return nil, err
		}
		if err := file.Truncate(0); err != nil {
			file.Close()
			lock.Close()
			return nil, err
		}
		if _, err := file.Write(tail); err != nil {
			file.Close()
			lock.Close()
			return nil, err
		}
		size = maxLogBytes
	}
	return &rotatingLog{path: path, file: file, size: size, lock: lock}, nil
}

func openLogFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o600)
}

func (l *rotatingLog) rotate() error {
	for index := logBackups; index >= 1; index-- {
		from := l.path
		if index > 1 {
			from = fmt.Sprintf("%s.%d", l.path, index-1)
		}
		if err := os.Rename(from, fmt.Sprintf("%s.%d", l.path, index)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	file, err := openLogFile(l.path)
	if err != nil {
		return err
	}
	l.file.Close()
	l.file, l.size = file, 0
	return nil
}

func (l *rotatingLog) Write(p []byte) (int, error) {
	written := 0
	for len(p) > 0 {
		if l.size >= maxLogBytes {
			if err := l.rotate(); err != nil {
				return written, err
			}
		}
		n := int(min(int64(len(p)), maxLogBytes-l.size))
		if _, err := l.file.Write(p[:n]); err != nil {
			return written, err
		}
		l.size += int64(n)
		written += n
		p = p[n:]
	}
	return written, nil
}

func (l *rotatingLog) Close() error {
	return errors.Join(l.file.Close(), l.lock.Close())
}

// logTail returns the last 8 KiB of the log at path.
func logTail(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	start := max(info.Size()-8192, 0)
	buf := make([]byte, info.Size()-start)
	n, err := file.ReadAt(buf, start)
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	return string(buf[:n]), nil
}
