package local

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Masterminds/semver/v3"

	"github.com/everr-labs/everr/packages/cli/internal/build"
)

const (
	collectorService = "everr-local-collector"
	uiService        = "everr-local-ui"
)

// Identity is what the collector's and the UI's /health endpoints report.
// Both must name the same instance for the pair to count as one running
// Everr.
type Identity struct {
	Service         string `json:"service"`
	Version         string `json:"version"`
	InstanceID      string `json:"instance_id"`
	ProtocolVersion uint32 `json:"protocol_version"`
	Status          string `json:"status"`
}

func uiIdentity(instanceID string) Identity {
	return Identity{
		Service:         uiService,
		Version:         build.Version(),
		InstanceID:      instanceID,
		ProtocolVersion: 1,
		Status:          "ok",
	}
}

type ServiceState int

const (
	StateStopped ServiceState = iota
	StateRunning
	StateStarting
	StateOccupied
	StateUnreachable
	StateNetworkBlocked
)

func (s ServiceState) Description() string {
	switch s {
	case StateRunning:
		return "running"
	case StateStarting:
		return "starting"
	case StateStopped:
		return "stopped"
	case StateOccupied:
		return "port occupied by an unrecognized service"
	case StateNetworkBlocked:
		return "unreachable (local network access is blocked)"
	default:
		return "unable to determine status (connection failed or timed out)"
	}
}

// Service is the observed state of one listener and, when it is running, its
// identity.
type Service struct {
	State    ServiceState
	Identity Identity
}

type Status struct {
	Collector Service
	UI        Service
	// OTLPListening is whether anything accepts connections on the OTLP
	// port. It tells the OTLP row apart from the SQL one when the collector
	// is not a running Everr instance.
	OTLPListening bool
}

func Inspect(ctx context.Context) Status {
	uiEndpoint := strings.TrimRight(build.LocalUIOrigin(), "/") + "/health"
	ui := make(chan Service, 1)
	go func() { ui <- Probe(ctx, uiEndpoint, uiService) }()
	otlp := make(chan bool, 1)
	go func() { otlp <- listening(build.OTLPHTTPOrigin()) }()
	collector := Probe(ctx, build.HealthcheckEndpoint(), collectorService)
	return Status{Collector: collector, UI: <-ui, OTLPListening: <-otlp}
}

func listening(origin string) bool {
	address, err := listenAddress(origin)
	if err != nil {
		return false
	}
	conn, err := net.DialTimeout("tcp", address, 500*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// RunningInstance returns the collector identity when the collector and UI
// belong to the same running instance.
func (s Status) RunningInstance() (Identity, bool) {
	if s.Collector.State == StateRunning && s.UI.State == StateRunning &&
		s.Collector.Identity.InstanceID == s.UI.Identity.InstanceID &&
		s.Collector.Identity.Version == s.UI.Identity.Version {
		return s.Collector.Identity, true
	}
	return Identity{}, false
}

func (s Status) starting() bool {
	return s.Collector.State == StateStarting || s.UI.State == StateStarting
}

func (s Status) Stopped() bool {
	return s.Collector.State == StateStopped && s.UI.State == StateStopped
}

func (s Status) mismatched() bool {
	_, ok := s.RunningInstance()
	return s.Collector.State == StateRunning && s.UI.State == StateRunning && !ok
}

func (s Status) Print(w io.Writer) {
	for _, row := range []struct{ label, value string }{
		{"otlp", s.otlpRow()},
		{"sql", s.sqlRow()},
		{"ui", describe(s.UI, build.LocalUIOrigin())},
	} {
		fmt.Fprintf(w, "%s: %s\n", row.label, row.value)
	}
	if s.mismatched() {
		fmt.Fprintln(w, "instance: collector and UI do not belong to the same Everr instance")
	}
}

func describe(service Service, origin string) string {
	if service.State == StateRunning {
		return origin
	}
	return service.State.Description()
}

// otlpRow follows the collector while it is a running or starting Everr
// instance. Otherwise the OTLP port is checked on its own, since the SQL
// health probe says nothing about it.
func (s Status) otlpRow() string {
	switch s.Collector.State {
	case StateStopped, StateOccupied:
		if s.OTLPListening {
			return StateOccupied.Description()
		}
		return StateStopped.Description()
	}
	return describe(s.Collector, build.OTLPHTTPOrigin())
}

// sqlRow shows the SQL endpoint as up when it answers as Everr with its
// pipeline stopped, since queries still work then.
func (s Status) sqlRow() string {
	if s.Collector.State == StateStopped && s.Collector.Identity.InstanceID != "" {
		return build.SQLHTTPOrigin()
	}
	return describe(s.Collector, build.SQLHTTPOrigin())
}

func (s Status) RequireStopped() error {
	if s.mismatched() {
		return errors.New("cannot start Everr: collector and UI do not belong to the same Everr instance; stop the existing instances, then retry")
	}
	if !s.Stopped() {
		return fmt.Errorf(
			"cannot start Everr: collector at %s: %s; local UI at %s: %s. Stop the existing instance or free the occupied address, then retry",
			build.SQLHTTPOrigin(), s.Collector.State.Description(),
			build.LocalUIOrigin(), s.UI.State.Description(),
		)
	}
	return nil
}

const maxHealthBody = 8192

var probeClient = &http.Client{
	Timeout:   500 * time.Millisecond,
	Transport: &http.Transport{Proxy: nil},
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// Probe reads endpoint's /health and accepts it only when it identifies
// service with a well-formed identity, so an unrelated listener on the port
// is never mistaken for Everr.
func Probe(ctx context.Context, endpoint, service string) Service {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Service{State: StateUnreachable}
	}
	resp, err := probeClient.Do(req)
	if err != nil {
		switch {
		case isPermissionDenied(err):
			return Service{State: StateNetworkBlocked}
		case errors.Is(err, syscall.ECONNREFUSED):
			return Service{State: StateStopped}
		}
		return Service{State: StateUnreachable}
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxHealthBody+1))
	if err != nil {
		return Service{State: StateUnreachable}
	}
	if len(body) > maxHealthBody {
		return Service{State: StateOccupied}
	}
	var identity Identity
	if err := json.Unmarshal(body, &identity); err != nil || identity.Service != service || identity.ProtocolVersion != 1 ||
		strings.TrimSpace(identity.InstanceID) == "" {
		return Service{State: StateOccupied}
	}
	if _, err := semver.StrictNewVersion(identity.Version); err != nil {
		return Service{State: StateOccupied}
	}
	switch {
	case resp.StatusCode == http.StatusOK && identity.Status == "ok":
		return Service{State: StateRunning, Identity: identity}
	case resp.StatusCode == http.StatusServiceUnavailable && identity.Status == "starting":
		return Service{State: StateStarting, Identity: identity}
	case resp.StatusCode == http.StatusServiceUnavailable && identity.Status == "stopped":
		// The supervisor is up, but its collector pipeline has exited.
		return Service{State: StateStopped, Identity: identity}
	}
	return Service{State: StateOccupied}
}

func isPermissionDenied(err error) bool {
	return errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EACCES)
}

// waitForCollector reports whether the collector at endpoint becomes ready
// as instanceID within timeout.
func waitForCollector(ctx context.Context, endpoint, instanceID string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if service := Probe(ctx, endpoint, collectorService); service.State == StateRunning && service.Identity.InstanceID == instanceID {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(100 * time.Millisecond):
		}
	}
	return false
}

// listenAddress validates that origin is a loopback HTTP origin and returns
// its host:port.
func listenAddress(origin string) (string, error) {
	u, err := url.Parse(origin)
	if err != nil {
		return "", fmt.Errorf("parse local listener address: %w", err)
	}
	if u.Scheme != "http" || u.Hostname() != "127.0.0.1" {
		return "", fmt.Errorf("local listener must use http://127.0.0.1: %s", origin)
	}
	port := u.Port()
	if port == "" {
		port = "80"
	}
	if _, err := strconv.ParseUint(port, 10, 16); err != nil {
		return "", fmt.Errorf("missing local port: %s", origin)
	}
	return net.JoinHostPort("127.0.0.1", port), nil
}

func requireFreePort(origin string) error {
	address, err := listenAddress(origin)
	if err != nil {
		return err
	}
	ln, err := net.Listen("tcp", address)
	if err != nil {
		return fmt.Errorf("cannot start Everr: address %s is unavailable; free it, then retry: %w", address, err)
	}
	return ln.Close()
}
