package local

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/everr-labs/everr/packages/cli/internal/assets"
	"github.com/everr-labs/everr/packages/cli/internal/build"
	"github.com/everr-labs/everr/packages/cli/internal/internaltelemetry"
)

type supervisorRequest struct {
	stop  bool
	reply chan error
}

type server struct {
	origin     string
	identity   Identity
	supervisor chan<- supervisorRequest
	sql        *sqlClient
	// telemetry is where the UI's own OTLP exports go, with credentials the
	// browser must never see. nil disables the proxy.
	telemetry *internaltelemetry.Config
	export    *http.Client
	ui        fs.FS
}

func newServer(origin, instanceID string, supervisor chan<- supervisorRequest, ui fs.FS, telemetry *internaltelemetry.Config) *server {
	return &server{
		origin:     origin,
		identity:   uiIdentity(instanceID),
		supervisor: supervisor,
		sql:        newSQLClient(build.SQLHTTPOrigin()),
		telemetry:  telemetry,
		ui:         ui,
		export: &http.Client{
			Timeout: internaltelemetry.ExportTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// localServer is the bound UI listener.
type localServer struct {
	listener net.Listener
	http     *http.Server
}

func bindServer(instanceID string, supervisor chan<- supervisorRequest) (*localServer, error) {
	ui, ok := assets.LocalUI()
	if !ok {
		return nil, errors.New("local UI assets are missing; build the CLI with `pnpm --filter @everr/cli build:debug`")
	}
	origin := build.LocalUIOrigin()
	address, err := listenAddress(origin)
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return nil, fmt.Errorf("cannot start Everr: local UI address %s is unavailable; another instance may be starting: %w", address, err)
	}
	s := newServer(origin, instanceID, supervisor, ui, internaltelemetry.FromEnv(internaltelemetry.SourceUI))
	return &localServer{
		listener: listener,
		http:     &http.Server{Handler: s.handler(), ReadHeaderTimeout: 5 * time.Second},
	}, nil
}

func (s *localServer) serve() error {
	if err := s.http.Serve(s.listener); !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve local UI: %w", err)
	}
	return nil
}

func (s *localServer) shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, s.identity)
	})
	mux.HandleFunc("POST /api/commands/{command}", s.command)
	mux.HandleFunc("POST /api/telemetry/{signal}", s.exportTelemetry)
	mux.HandleFunc("GET /api/", http.NotFound)
	mux.HandleFunc("GET /", s.asset)
	return s.protect(mux)
}

// protect rejects DNS-rebinding hosts and cross-site API calls: the API
// requires this server's own Origin plus a custom header a simple
// cross-origin request cannot set.
func (s *server) protect(next http.Handler) http.Handler {
	expectedHost := strings.TrimPrefix(s.origin, "http://")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != expectedHost {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			origin := r.Header.Get("Origin")
			// The local-app dev server proxies here from its own origin.
			validOrigin := origin == s.origin || (!build.Release && origin == "http://127.0.0.1:1420")
			if !validOrigin || r.Header.Get("X-Everr-Local") != "1" {
				w.WriteHeader(http.StatusForbidden)
				return
			}
		}
		header := w.Header()
		header.Set("Cache-Control", "no-store")
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func (s *server) asset(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	for segment := range strings.SplitSeq(name, "/") {
		if segment == ".." {
			http.NotFound(w, r)
			return
		}
	}
	data, err := fs.ReadFile(s.ui, name)
	if err != nil || name == "" {
		// Client-side routes have no file extension; serve the app shell.
		if strings.Contains(path.Base(name), ".") && name != "" {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
		if data, err = fs.ReadFile(s.ui, name); err != nil {
			http.NotFound(w, r)
			return
		}
	}
	contentType := mime.TypeByExtension(filepath.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	_, _ = w.Write(data)
}

func (s *server) command(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	value, err := s.dispatch(r.Context(), r.PathValue("command"), body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (s *server) exportTelemetry(w http.ResponseWriter, r *http.Request) {
	signal := r.PathValue("signal")
	if signal != "logs" && signal != "traces" && signal != "metrics" {
		http.NotFound(w, r)
		return
	}
	if s.telemetry == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, s.telemetry.SignalEndpoint(signal), bytes.NewReader(body))
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	for key, values := range s.telemetry.Headers {
		req.Header[key] = values
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.export.Do(req)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type collectorStatus struct {
	Status         string `json:"status"`
	OTLPEndpoint   string `json:"otlpEndpoint"`
	SQLEndpoint    string `json:"sqlEndpoint"`
	HealthEndpoint string `json:"healthEndpoint"`
	TelemetryDir   string `json:"telemetryDir"`
}

type telemetryContext struct {
	ServiceVersion        string `json:"serviceVersion"`
	TelemetryEnabled      bool   `json:"telemetryEnabled"`
	DeploymentEnvironment string `json:"deploymentEnvironment"`
}

func (s *server) dispatch(ctx context.Context, command string, args []byte) (any, error) {
	switch command {
	case "get_collector_status":
		return s.collectorStatus(ctx)
	case "restart_collector":
		if err := s.ask(ctx, supervisorRequest{}, "collector supervisor stopped", "collector restart interrupted"); err != nil {
			return nil, err
		}
		return s.collectorStatus(ctx)
	case "stop_local":
		var stopArgs stopLocalArgs
		if err := json.Unmarshal(args, &stopArgs); err != nil {
			return nil, err
		}
		if stopArgs.InstanceID != s.identity.InstanceID {
			return nil, errors.New("local instance changed; check status and retry")
		}
		dir, err := build.TelemetryDir()
		if err != nil {
			return nil, err
		}
		lockPath, err := filepath.EvalSymlinks(filepath.Join(dir, "local.lock"))
		if err == nil {
			lockPath, err = filepath.Abs(lockPath)
		}
		if err != nil {
			return nil, fmt.Errorf("resolve local supervisor lock: %w", err)
		}
		if err := s.ask(ctx, supervisorRequest{stop: true}, "local supervisor stopped", "local shutdown interrupted"); err != nil {
			return nil, err
		}
		return stopLocalResponse{LockPath: lockPath}, nil
	case "telemetry_sql_query":
		sql, params, err := parseSQLArgs(args)
		if err != nil {
			return nil, fmt.Errorf("invalid SQL arguments: %w", err)
		}
		return s.sql.Query(ctx, sql, params)
	case "get_telemetry_context":
		return telemetryContext{
			ServiceVersion:        build.Version(),
			TelemetryEnabled:      s.telemetry != nil,
			DeploymentEnvironment: internaltelemetry.DeploymentEnvironment(),
		}, nil
	}
	return nil, fmt.Errorf("unknown local command: %s", command)
}

// ask hands a request to the supervisor loop and waits for its reply.
func (s *server) ask(ctx context.Context, req supervisorRequest, unavailable, interrupted string) error {
	req.reply = make(chan error, 1)
	select {
	case s.supervisor <- req:
	case <-ctx.Done():
		return errors.New(unavailable)
	}
	select {
	case err := <-req.reply:
		return err
	case <-ctx.Done():
		return errors.New(interrupted)
	}
}

// parseSQLArgs accepts {"sql": string, "params"?: object}, rejecting the
// shapes serde rejected (missing or non-string sql, non-object params).
func parseSQLArgs(args []byte) (string, map[string]json.RawMessage, error) {
	var raw struct {
		SQL    *string         `json:"sql"`
		Params json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal(args, &raw); err != nil {
		return "", nil, err
	}
	if raw.SQL == nil {
		return "", nil, errors.New("missing field `sql`")
	}
	params := map[string]json.RawMessage{}
	if raw.Params != nil {
		if trimmed := bytes.TrimSpace(raw.Params); len(trimmed) == 0 || trimmed[0] != '{' {
			return "", nil, errors.New("params must be an object")
		}
		if err := json.Unmarshal(raw.Params, &params); err != nil {
			return "", nil, err
		}
		for name, value := range params {
			var compact bytes.Buffer
			if err := json.Compact(&compact, value); err != nil {
				return "", nil, err
			}
			params[name] = compact.Bytes()
		}
	}
	return *raw.SQL, params, nil
}

func (s *server) collectorStatus(ctx context.Context) (collectorStatus, error) {
	health := build.HealthcheckEndpoint()
	status := "stopped"
	if waitForCollector(ctx, health, s.identity.InstanceID, time.Second) {
		status = "running"
	}
	dir, err := build.TelemetryDir()
	if err != nil {
		return collectorStatus{}, err
	}
	return collectorStatus{
		Status:         status,
		OTLPEndpoint:   build.OTLPHTTPOrigin(),
		SQLEndpoint:    build.SQLHTTPOrigin(),
		HealthEndpoint: health,
		TelemetryDir:   dir,
	}, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
