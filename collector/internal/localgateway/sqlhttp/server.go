package sqlhttp

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	"go.uber.org/zap"
)

type Identity struct {
	Version    string
	InstanceID string
}

type Server struct {
	identity Identity
	cfg      Config
	handle   *chdb.Handle
	logger   *zap.Logger

	server       *http.Server
	listener     net.Listener
	shutdownOnce sync.Once
	ready        atomic.Bool
}

func NewServer(cfg Config, handle *chdb.Handle, logger *zap.Logger, identity Identity) *Server {
	return &Server{
		identity: identity,
		cfg:      cfg.Applied(),
		handle:   handle,
		logger:   logger,
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

	mux := http.NewServeMux()
	mux.Handle("/sql", handler)
	mux.HandleFunc("GET /health", s.handleHealth)

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

func (s *Server) SetReady(ready bool) {
	s.ready.Store(ready)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	status, code := "ok", http.StatusOK
	if !s.ready.Load() {
		status, code = "starting", http.StatusServiceUnavailable
	}
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"service":          "everr-local-collector",
		"version":          s.identity.Version,
		"instance_id":      s.identity.InstanceID,
		"protocol_version": 1,
		"status":           status,
	})
}
