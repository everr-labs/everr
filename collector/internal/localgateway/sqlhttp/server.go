package sqlhttp

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	"go.uber.org/zap"
)

type Server struct {
	cfg    Config
	handle *chdb.Handle
	logger *zap.Logger

	server       *http.Server
	listener     net.Listener
	shutdownOnce sync.Once
}

func NewServer(cfg Config, handle *chdb.Handle, logger *zap.Logger) *Server {
	return &Server{
		cfg:    cfg.Applied(),
		handle: handle,
		logger: logger,
	}
}

func (s *Server) Start() error {
	handler := &handler{
		handle:         s.handle,
		queryTimeout:   s.cfg.QueryTimeout,
		enqueueTimeout: s.cfg.EnqueueTimeout,
		maxBytes:       s.cfg.MaxResultBytes,
		logger:         s.logger,
	}
	handler.ready.Store(true)

	mux := http.NewServeMux()
	mux.Handle("/sql", handler)

	ln, err := net.Listen("tcp", s.cfg.Endpoint)
	if err != nil {
		return err
	}
	s.listener = ln
	s.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		if err := s.server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("sqlhttp serve", zap.Error(err))
		}
	}()

	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	var err error
	s.shutdownOnce.Do(func() {
		if s.server != nil {
			err = s.server.Shutdown(ctx)
		}
	})
	return err
}
