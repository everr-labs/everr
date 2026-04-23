package chdbhandle

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/chdb-io/chdb-go/chdb"
)

var (
	ErrQueueFull  = errors.New("chdb handle queue full")
	ErrPathPinned = errors.New("chdb handle path pinned to a different path")
	ErrClosed     = errors.New("chdb handle closed")
)

const defaultQueueSize = 64

type Result interface {
	Buf() []byte
	Free()
}

type Session interface {
	Query(query string, outputFormats ...string) (Result, error)
	Close()
	Path() string
}

type chdbSession struct {
	*chdb.Session
}

func (s *chdbSession) Query(query string, outputFormats ...string) (Result, error) {
	return s.Session.Query(query, outputFormats...)
}

type Metrics struct {
	Path          string
	QueueCapacity int
	QueueLength   int
	Submitted     uint64
	Completed     uint64
	Failed        uint64
	QueueFull     uint64
	Closed        bool
}

type request struct {
	ctx  context.Context
	fn   func(context.Context, Session) error
	done chan error
}

type sessionFactory func(path string) (Session, error)

type options struct {
	queueSize  int
	newSession sessionFactory
}

type Option func(*options)

func withQueueSize(size int) Option {
	return func(opts *options) {
		if size > 0 {
			opts.queueSize = size
		}
	}
}

func withSessionFactory(factory sessionFactory) Option {
	return func(opts *options) {
		if factory != nil {
			opts.newSession = factory
		}
	}
}

type Handle struct {
	path string

	session Session
	jobs    chan request
	stopCh  chan struct{}
	doneCh  chan struct{}

	closeOnce sync.Once
	closed    atomic.Bool

	submitted atomic.Uint64
	completed atomic.Uint64
	failed    atomic.Uint64
	queueFull atomic.Uint64
}

var singleton struct {
	mu     sync.Mutex
	handle *Handle
	path   string
}

func Open(path string, opts ...Option) (*Handle, error) {
	cleanPath, err := normalizePath(path)
	if err != nil {
		return nil, err
	}

	options := options{
		queueSize: defaultQueueSize,
		newSession: func(path string) (Session, error) {
			session, err := chdb.NewSession(path)
			if err != nil {
				return nil, err
			}
			return &chdbSession{Session: session}, nil
		},
	}
	for _, opt := range opts {
		opt(&options)
	}

	singleton.mu.Lock()
	defer singleton.mu.Unlock()

	if singleton.path == "" {
		handle, err := newHandle(cleanPath, options)
		if err != nil {
			return nil, err
		}
		singleton.path = cleanPath
		singleton.handle = handle
		return handle, nil
	}

	if singleton.path != cleanPath {
		return nil, fmt.Errorf("%w: have %q, want %q", ErrPathPinned, singleton.path, cleanPath)
	}

	return singleton.handle, nil
}

func newHandle(path string, opts options) (*Handle, error) {
	session, err := opts.newSession(path)
	if err != nil {
		return nil, err
	}

	handle := &Handle{
		path:    path,
		session: session,
		jobs:    make(chan request, opts.queueSize),
		stopCh:  make(chan struct{}),
		doneCh:  make(chan struct{}),
	}
	go handle.run()
	return handle, nil
}

func (h *Handle) Do(ctx context.Context, fn func(context.Context, Session) error) error {
	if ctx == nil {
		ctx = context.Background()
	}
	done, err := h.Enqueue(ctx, fn)
	if err != nil || done == nil {
		return err
	}
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Enqueue submits work to the single chdb worker and returns a buffered
// completion channel. Callers that need separate queueing and execution
// deadlines can stop waiting on the returned channel without blocking the
// worker's eventual send.
func (h *Handle) Enqueue(ctx context.Context, fn func(context.Context, Session) error) (<-chan error, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if fn == nil {
		done := make(chan error, 1)
		done <- nil
		return done, nil
	}
	if h.closed.Load() {
		return nil, ErrClosed
	}

	req := request{
		ctx:  ctx,
		fn:   fn,
		done: make(chan error, 1),
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-h.stopCh:
		return nil, ErrClosed
	default:
	}

	select {
	case h.jobs <- req:
		h.submitted.Add(1)
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-h.stopCh:
		return nil, ErrClosed
	default:
		h.queueFull.Add(1)
		return nil, ErrQueueFull
	}

	return req.done, nil
}

func (h *Handle) Close() error {
	h.closeOnce.Do(func() {
		h.closed.Store(true)
		close(h.stopCh)
		<-h.doneCh
	})
	return nil
}

func (h *Handle) Metrics() Metrics {
	return Metrics{
		Path:          h.path,
		QueueCapacity: cap(h.jobs),
		QueueLength:   len(h.jobs),
		Submitted:     h.submitted.Load(),
		Completed:     h.completed.Load(),
		Failed:        h.failed.Load(),
		QueueFull:     h.queueFull.Load(),
		Closed:        h.closed.Load(),
	}
}

func (h *Handle) run() {
	defer close(h.doneCh)

	for {
		select {
		case <-h.stopCh:
			h.drainPending()
			h.session.Close()
			return
		case req := <-h.jobs:
			err := h.execute(req)
			req.done <- err
			if h.closed.Load() {
				h.drainPending()
				h.session.Close()
				return
			}
		}
	}
}

func (h *Handle) execute(req request) error {
	if h.closed.Load() {
		return ErrClosed
	}

	err := req.fn(req.ctx, h.session)
	if err != nil {
		h.failed.Add(1)
		return err
	}

	h.completed.Add(1)
	return nil
}

func (h *Handle) drainPending() {
	for {
		select {
		case req := <-h.jobs:
			req.done <- ErrClosed
		default:
			return
		}
	}
}

func normalizePath(path string) (string, error) {
	if path == "" {
		return "", errors.New("chdb handle path required")
	}
	return filepath.Abs(path)
}

func ResetForTesting() {
	singleton.mu.Lock()
	defer singleton.mu.Unlock()

	if singleton.handle != nil {
		_ = singleton.handle.Close()
	}
	singleton.handle = nil
	singleton.path = ""
}
