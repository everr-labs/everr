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

// Status is the pipeline state the /health endpoint reports. Only StatusOK
// answers 200.
type Status string

const (
	StatusStarting Status = "starting"
	StatusOK       Status = "ok"
	StatusStopped  Status = "stopped"
)

type Server struct {
	identity Identity
	cfg      Config
	handle   *chdb.Handle
	logger   *zap.Logger

	server       *http.Server
	listener     net.Listener
	shutdownOnce sync.Once
	status       atomic.Value
}

func NewServer(cfg Config, handle *chdb.Handle, logger *zap.Logger, identity Identity) *Server {
	s := &Server{
		identity: identity,
		cfg:      cfg.Applied(),
		handle:   handle,
		logger:   logger,
	}
	s.status.Store(StatusStarting)
	return s
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

func (s *Server) SetStatus(status Status) {
	s.status.Store(status)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	status, code := s.status.Load().(Status), http.StatusOK
	if status != StatusOK {
		code = http.StatusServiceUnavailable
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
