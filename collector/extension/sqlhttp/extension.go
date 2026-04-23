package sqlhttp

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/everr-labs/chdbexporter/chdbhandle"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
	"go.uber.org/zap"
)

type sqlExt struct {
	cfg    Config
	logger *zap.Logger

	handle   *chdbhandle.Handle
	handler  *handler
	server   *http.Server
	listener net.Listener

	stopCh       chan struct{}
	shutdownOnce sync.Once
}

func newExtension(cfg *Config, settings extension.Settings) *sqlExt {
	return &sqlExt{
		cfg:    cfg.applied(),
		logger: settings.Logger,
		stopCh: make(chan struct{}),
	}
}

func (e *sqlExt) Start(context.Context, component.Host) error {
	handle, err := chdbhandle.Open(e.cfg.Path)
	if err != nil {
		return err
	}
	e.handle = handle

	e.handler = &handler{
		handle:         handle,
		queryTimeout:   e.cfg.QueryTimeout,
		enqueueTimeout: e.cfg.EnqueueTimeout,
		maxBytes:       e.cfg.MaxResultBytes,
		logger:         e.logger,
	}

	mux := http.NewServeMux()
	mux.Handle("/sql", e.handler)

	ln, err := net.Listen("tcp", e.cfg.Endpoint)
	if err != nil {
		return err
	}
	e.listener = ln
	e.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		if err := e.server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			e.logger.Error("sqlhttp serve", zap.Error(err))
		}
	}()
	go e.probeReady()

	return nil
}

func (e *sqlExt) Shutdown(ctx context.Context) error {
	var err error

	e.shutdownOnce.Do(func() {
		close(e.stopCh)
		if e.server != nil {
			err = e.server.Shutdown(ctx)
		}
		if e.handle != nil {
			_ = e.handle.Close()
		}
	})

	return err
}

func (e *sqlExt) probeReady() {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-e.stopCh:
			return
		case <-ticker.C:
		}

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		err := e.handle.Do(ctx, func(_ context.Context, s chdbhandle.Session) error {
			result, err := s.Query("SELECT 1 FROM otel_logs LIMIT 1", "JSONEachRow")
			if err != nil {
				return err
			}
			result.Free()
			return nil
		})
		cancel()

		if err == nil {
			e.handler.ready.Store(true)
			return
		}
	}
}
