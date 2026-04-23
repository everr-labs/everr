package chdbhandle

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeResult struct{}

func (fakeResult) Buf() []byte { return nil }
func (fakeResult) Free()       {}

type fakeSession struct {
	path       string
	closeCount atomic.Int32
}

func (s *fakeSession) Query(string, ...string) (Result, error) {
	return fakeResult{}, nil
}

func (s *fakeSession) Close() {
	s.closeCount.Add(1)
}

func (s *fakeSession) Path() string {
	return s.path
}

func TestOpenReturnsSingletonForPinnedPath(t *testing.T) {
	t.Cleanup(ResetForTesting)

	var opens atomic.Int32
	makeSession := func(path string) (Session, error) {
		opens.Add(1)
		return &fakeSession{path: path}, nil
	}

	path := filepath.Join(t.TempDir(), "telemetry")
	first, err := Open(path, withQueueSize(2), withSessionFactory(makeSession))
	if err != nil {
		t.Fatalf("Open() first error = %v", err)
	}

	second, err := Open(path, withQueueSize(8), withSessionFactory(makeSession))
	if err != nil {
		t.Fatalf("Open() second error = %v", err)
	}

	if first != second {
		t.Fatalf("expected singleton handle instance")
	}

	if opens.Load() != 1 {
		t.Fatalf("expected one session open, got %d", opens.Load())
	}
}

func TestOpenRejectsDifferentPathForever(t *testing.T) {
	t.Cleanup(ResetForTesting)

	firstPath := filepath.Join(t.TempDir(), "first")
	secondPath := filepath.Join(t.TempDir(), "second")

	handle, err := Open(firstPath, withSessionFactory(func(path string) (Session, error) {
		return &fakeSession{path: path}, nil
	}))
	if err != nil {
		t.Fatalf("Open(first) error = %v", err)
	}

	if err := handle.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	_, err = Open(secondPath, withSessionFactory(func(path string) (Session, error) {
		return &fakeSession{path: path}, nil
	}))
	if !errors.Is(err, ErrPathPinned) {
		t.Fatalf("Open(second) error = %v, want ErrPathPinned", err)
	}
}

func TestDoUsesSingleWorkerAndBoundedQueue(t *testing.T) {
	t.Cleanup(ResetForTesting)

	handle, err := Open(filepath.Join(t.TempDir(), "queue"), withQueueSize(1), withSessionFactory(func(path string) (Session, error) {
		return &fakeSession{path: path}, nil
	}))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	var running atomic.Int32
	var maxRunning atomic.Int32

	runBlocking := func(ctx context.Context, _ Session) error {
		current := running.Add(1)
		for {
			seen := maxRunning.Load()
			if current <= seen || maxRunning.CompareAndSwap(seen, current) {
				break
			}
		}
		close(started)
		<-release
		running.Add(-1)
		return nil
	}

	firstDone := make(chan error, 1)
	go func() {
		firstDone <- handle.Do(t.Context(), runBlocking)
	}()
	<-started

	secondDone := make(chan error, 1)
	go func() {
		secondDone <- handle.Do(t.Context(), func(context.Context, Session) error {
			current := running.Add(1)
			for {
				seen := maxRunning.Load()
				if current <= seen || maxRunning.CompareAndSwap(seen, current) {
					break
				}
			}
			running.Add(-1)
			return nil
		})
	}()
	waitForSubmitted(t, handle, 2)

	thirdErr := handle.Do(t.Context(), func(context.Context, Session) error { return nil })
	if !errors.Is(thirdErr, ErrQueueFull) {
		t.Fatalf("third Do() error = %v, want ErrQueueFull", thirdErr)
	}

	close(release)

	if err := <-firstDone; err != nil {
		t.Fatalf("first Do() error = %v", err)
	}
	if err := <-secondDone; err != nil {
		t.Fatalf("second Do() error = %v", err)
	}
	if maxRunning.Load() != 1 {
		t.Fatalf("max concurrent workers = %d, want 1", maxRunning.Load())
	}
}

func TestEnqueueReturnsWithoutWaitingForExecution(t *testing.T) {
	t.Cleanup(ResetForTesting)

	handle, err := Open(filepath.Join(t.TempDir(), "enqueue"), withQueueSize(1), withSessionFactory(func(path string) (Session, error) {
		return &fakeSession{path: path}, nil
	}))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	firstDone, err := handle.Enqueue(t.Context(), func(context.Context, Session) error {
		close(started)
		<-release
		return nil
	})
	if err != nil {
		t.Fatalf("first Enqueue() error = %v", err)
	}
	<-started

	start := time.Now()
	secondDone, err := handle.Enqueue(t.Context(), func(context.Context, Session) error { return nil })
	if err != nil {
		t.Fatalf("second Enqueue() error = %v", err)
	}
	if elapsed := time.Since(start); elapsed > 50*time.Millisecond {
		t.Fatalf("Enqueue() blocked for %s, want fast enqueue", elapsed)
	}

	close(release)

	if err := <-firstDone; err != nil {
		t.Fatalf("first Enqueue() completion error = %v", err)
	}
	if err := <-secondDone; err != nil {
		t.Fatalf("second Enqueue() completion error = %v", err)
	}
}

func TestCloseMakesPendingAndFutureCallsSafe(t *testing.T) {
	t.Cleanup(ResetForTesting)

	var created atomic.Pointer[fakeSession]
	handle, err := Open(filepath.Join(t.TempDir(), "close"), withQueueSize(1), withSessionFactory(func(path string) (Session, error) {
		session := &fakeSession{path: path}
		created.Store(session)
		return session, nil
	}))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}

	blocked := make(chan struct{})
	release := make(chan struct{})
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- handle.Do(t.Context(), func(context.Context, Session) error {
			close(blocked)
			<-release
			return nil
		})
	}()
	<-blocked

	secondDone := make(chan error, 1)
	go func() {
		secondDone <- handle.Do(t.Context(), func(context.Context, Session) error { return nil })
	}()
	waitForSubmitted(t, handle, 2)

	closeDone := make(chan error, 1)
	go func() {
		closeDone <- handle.Close()
	}()
	waitForClosed(t, handle)

	close(release)

	if err := <-closeDone; err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	if err := handle.Close(); err != nil {
		t.Fatalf("Close() second error = %v", err)
	}

	if err := <-firstDone; err != nil {
		t.Fatalf("first Do() error = %v", err)
	}
	if err := <-secondDone; !errors.Is(err, ErrClosed) {
		t.Fatalf("second Do() error = %v, want ErrClosed", err)
	}

	err = handle.Do(t.Context(), func(context.Context, Session) error { return nil })
	if !errors.Is(err, ErrClosed) {
		t.Fatalf("future Do() error = %v, want ErrClosed", err)
	}

	session := created.Load()
	if session == nil {
		t.Fatalf("expected created session")
	}
	if session.closeCount.Load() != 1 {
		t.Fatalf("session Close() count = %d, want 1", session.closeCount.Load())
	}
}

func waitForSubmitted(t *testing.T, handle *Handle, want uint64) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if handle.Metrics().Submitted >= want {
			return
		}
		time.Sleep(time.Millisecond)
	}

	t.Fatalf("submitted jobs = %d, want at least %d", handle.Metrics().Submitted, want)
}

func waitForClosed(t *testing.T, handle *Handle) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if handle.closed.Load() {
			return
		}
		time.Sleep(time.Millisecond)
	}

	t.Fatalf("handle did not enter closed state")
}

func TestMetricsTrackLifecycle(t *testing.T) {
	t.Cleanup(ResetForTesting)

	handle, err := Open(filepath.Join(t.TempDir(), "metrics"), withQueueSize(1), withSessionFactory(func(path string) (Session, error) {
		return &fakeSession{path: path}, nil
	}))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}

	var seen sync.Map
	if err := handle.Do(t.Context(), func(_ context.Context, session Session) error {
		seen.Store("path", session.Path())
		return nil
	}); err != nil {
		t.Fatalf("Do() error = %v", err)
	}

	metrics := handle.Metrics()
	if metrics.Path == "" {
		t.Fatalf("expected metrics path")
	}
	if metrics.Submitted != 1 {
		t.Fatalf("Submitted = %d, want 1", metrics.Submitted)
	}
	if metrics.Completed != 1 {
		t.Fatalf("Completed = %d, want 1", metrics.Completed)
	}
	if metrics.QueueFull != 0 {
		t.Fatalf("QueueFull = %d, want 0", metrics.QueueFull)
	}
	if _, ok := seen.Load("path"); !ok {
		t.Fatalf("expected Do callback to run")
	}
}
