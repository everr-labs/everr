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
	"time"

	"golang.org/x/sys/unix"

	"github.com/everr-labs/everr/packages/cli/internal/build"
)

const (
	maxLogBytes = 5 * 1024 * 1024
	logBackups  = 3
	// logCheckInterval is how often the log's size is checked, so a log can
	// outgrow maxLogBytes by what is written in one interval.
	logCheckInterval = time.Second
)

// logPath is the detached supervisor's log file.
func logPath() (string, error) {
	if dir := os.Getenv("EVERR_LOCAL_LOG_DIR"); dir != "" {
		return filepath.Join(dir, "local.log"), nil
	}
	home, err := build.HomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory for local logs: %w", err)
	}
	return filepath.Join(defaultLogDir(home, os.Getenv("XDG_STATE_HOME")), "local.log"), nil
}

func defaultLogDir(home, state string) string {
	app := "everr"
	if !build.Release {
		app = "everr-dev"
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Logs", app)
	}
	if !filepath.IsAbs(state) {
		state = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(state, app)
}

// StartLogCapture points stdout and stderr at the local log when this process
// is the detached supervisor, so output from the supervisor, the in-process
// collector, and the Go runtime all land there. The descriptors name the log
// file itself rather than a pipe this process drains: the runtime stops every
// goroutine before it prints a crash, and nothing would be left to drain it.
// stop restores the original descriptors.
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
	var saved []int
	restore := func() {
		for i, dup := range saved {
			_ = unix.Dup2(dup, log.fds[i])
			_ = unix.Close(dup)
		}
	}
	for _, fd := range log.fds {
		dup, err := unix.Dup(fd)
		if err != nil {
			restore()
			log.Close()
			return nil, false, err
		}
		saved = append(saved, dup)
	}
	if err := log.redirect(log.file); err != nil {
		restore()
		log.Close()
		return nil, false, err
	}

	quit := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(logCheckInterval)
		defer ticker.Stop()
		failing := false
		for {
			select {
			case <-quit:
				return
			case <-ticker.C:
				err := log.rotateIfFull()
				if err != nil && !failing {
					fmt.Fprintf(os.Stderr, "could not rotate the local supervisor log: %v\n", err)
				}
				failing = err != nil
			}
		}
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			close(quit)
			<-done
			restore()
			log.Close()
		})
	}, true, nil
}

// rotatingLog is the local log file that fds 1 and 2 write to. It keeps at
// most maxLogBytes per file, checked every logCheckInterval, plus logBackups
// rotated copies, and holds a lock so two supervisors never write one log.
type rotatingLog struct {
	path string
	file *os.File
	lock *os.File
	// fds are the descriptors that write to file.
	fds []int
}

func openRotatingLog(path string) (_ *rotatingLog, err error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create local log directory: %w", err)
	}
	lock, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	var file *os.File
	defer func() {
		if err != nil {
			if file != nil {
				file.Close()
			}
			lock.Close()
		}
	}()
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return nil, busyError{fmt.Errorf("another instance is writing to this local log directory; use EVERR_LOCAL_LOG_DIR for a separate instance: %w", err)}
	}
	if file, err = os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o600); err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if size := info.Size(); size > maxLogBytes {
		tail := make([]byte, maxLogBytes)
		if _, err := file.ReadAt(tail, size-maxLogBytes); err != nil && !errors.Is(err, io.EOF) {
			return nil, err
		}
		if err := file.Truncate(0); err != nil {
			return nil, err
		}
		if _, err := file.Write(tail); err != nil {
			return nil, err
		}
	}
	return &rotatingLog{path: path, file: file, lock: lock, fds: []int{1, 2}}, nil
}

func (l *rotatingLog) redirect(file *os.File) error {
	for _, fd := range l.fds {
		if err := unix.Dup2(int(file.Fd()), fd); err != nil {
			return err
		}
	}
	return nil
}

func (l *rotatingLog) rotateIfFull() error {
	info, err := l.file.Stat()
	if err != nil || info.Size() < maxLogBytes {
		return err
	}
	return l.rotate()
}

// rotate moves the log to path.1 and its backups one place up, then points
// fds 1 and 2 at a new log. The new file is created first, so a failure to
// create it, as on a full disk, leaves the log as it was for the next try.
func (l *rotatingLog) rotate() (err error) {
	next, err := os.OpenFile(l.path+".next", os.O_CREATE|os.O_WRONLY|os.O_APPEND|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			next.Close()
		}
	}()
	for index := logBackups; index >= 1; index-- {
		from := l.path
		if index > 1 {
			from = fmt.Sprintf("%s.%d", l.path, index-1)
		}
		if err := os.Rename(from, fmt.Sprintf("%s.%d", l.path, index)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	if err := os.Rename(next.Name(), l.path); err != nil {
		return err
	}
	if err := l.redirect(next); err != nil {
		return err
	}
	l.file.Close()
	l.file = next
	return nil
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
