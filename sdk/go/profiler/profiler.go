// Package profiler continuously profiles a Go program and exports the
// profiles as OTLP profiles over HTTP.
//
// Every interval it collects a CPU profile and a heap profile and posts them
// to the collector's /v1development/profiles endpoint:
//
//   - CPU: cpu/nanoseconds and samples/count for the interval.
//   - Heap: inuse_space/bytes and inuse_objects/count, a snapshot of live
//     memory as of the last GC, and alloc_space/bytes and alloc_objects/count,
//     what was allocated during the interval.
//
// Goroutine labels set with pprof.Do or pprof.SetGoroutineLabels become
// sample attributes. Wrap the tracer provider with TracerProvider to link CPU
// samples to the span that was active when they were taken.
package profiler

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"runtime/pprof"
	"strings"
	"sync"
	"time"

	"github.com/google/pprof/profile"
	"github.com/grafana/pyroscope-go/godeltaprof"
	"go.opentelemetry.io/otel"
	"google.golang.org/protobuf/proto"
)

const (
	scopeName = "github.com/everr-labs/everr/sdk/go/profiler"
	version   = "0.1.0"

	defaultInterval = 15 * time.Second
	profilesPath    = "/v1development/profiles"
)

// Config configures the profiler. Unset fields fall back to the standard
// OpenTelemetry environment variables.
type Config struct {
	// Endpoint is the full URL profiles are posted to. Defaults to
	// OTEL_EXPORTER_OTLP_PROFILES_ENDPOINT, or OTEL_EXPORTER_OTLP_ENDPOINT
	// with /v1development/profiles appended.
	Endpoint string
	// Headers are sent with every export, for example
	// {"Authorization": "Bearer <ingest-key>"}. Merged over
	// OTEL_EXPORTER_OTLP_HEADERS and OTEL_EXPORTER_OTLP_PROFILES_HEADERS.
	Headers map[string]string
	// ServiceName sets service.name. Defaults to OTEL_SERVICE_NAME.
	ServiceName string
	// ResourceAttributes describe the process, such as
	// deployment.environment.name and service.version. Merged over
	// OTEL_RESOURCE_ATTRIBUTES.
	ResourceAttributes map[string]string
	// Interval is how often profiles are collected and exported. Defaults to 15s.
	Interval time.Duration
	// HTTPClient sends the exports. Defaults to a client with a 10s timeout.
	HTTPClient *http.Client
}

// Profiler is a running profiler. Stop it before the process exits to export
// the last interval.
type Profiler struct {
	cfg      resolved
	heap     *godeltaprof.HeapProfiler
	cpu      bytes.Buffer
	cpuOn    bool
	start    time.Time
	stop     chan struct{}
	done     chan struct{}
	stopOnce sync.Once
}

type resolved struct {
	endpoint string
	headers  map[string]string
	resource map[string]string
	interval time.Duration
	client   *http.Client
}

// Start begins profiling. It fails when no endpoint is configured.
func Start(cfg Config) (*Profiler, error) {
	r, err := resolve(cfg)
	if err != nil {
		return nil, err
	}
	p := &Profiler{
		cfg:   r,
		heap:  godeltaprof.NewHeapProfiler(),
		stop:  make(chan struct{}),
		done:  make(chan struct{}),
		start: time.Now(),
	}
	// Allocations made before Start would otherwise land in the first interval.
	_ = p.heap.Profile(io.Discard)
	p.startCPU()
	go p.run()
	return p, nil
}

// Stop stops profiling and exports what was collected since the last export.
func (p *Profiler) Stop(ctx context.Context) error {
	p.stopOnce.Do(func() { close(p.stop) })
	select {
	case <-p.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *Profiler) run() {
	defer close(p.done)
	ticker := time.NewTicker(p.cfg.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			p.flush(true)
		case <-p.stop:
			p.flush(false)
			return
		}
	}
}

// startCPU fails when something else, such as a /debug/pprof/profile request,
// already holds the process's one CPU profile. That interval then has no CPU
// profile and the next one tries again.
func (p *Profiler) startCPU() {
	p.cpu.Reset()
	p.cpuOn = pprof.StartCPUProfile(&p.cpu) == nil
}

func (p *Profiler) flush(restart bool) {
	end := time.Now()
	w := window{start: p.start, duration: end.Sub(p.start)}
	p.start = end

	var profiles []*profile.Profile
	if p.cpuOn {
		pprof.StopCPUProfile()
		if cpu, err := profile.Parse(&p.cpu); err == nil {
			profiles = append(profiles, cpu)
		} else {
			otel.Handle(fmt.Errorf("profiler: parse CPU profile: %w", err))
		}
	}
	if restart {
		p.startCPU()
	}

	var heap bytes.Buffer
	if err := p.heap.Profile(&heap); err == nil {
		if h, err := profile.Parse(&heap); err == nil {
			profiles = append(profiles, h)
		} else {
			otel.Handle(fmt.Errorf("profiler: parse heap profile: %w", err))
		}
	} else {
		otel.Handle(fmt.Errorf("profiler: heap profile: %w", err))
	}

	if len(profiles) == 0 {
		return
	}
	if err := p.export(toOTLP(profiles, w, p.cfg.resource)); err != nil {
		otel.Handle(fmt.Errorf("profiler: export: %w", err))
	}
}

func (p *Profiler) export(request proto.Message) error {
	body, err := proto.Marshal(request)
	if err != nil {
		return err
	}
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	_, _ = zw.Write(body)
	if err := zw.Close(); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.cfg.endpoint, &gz)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.Header.Set("Content-Encoding", "gzip")
	for k, v := range p.cfg.headers {
		req.Header.Set(k, v)
	}
	resp, err := p.cfg.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(msg)))
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

func resolve(cfg Config) (resolved, error) {
	endpoint := cfg.Endpoint
	if endpoint == "" {
		endpoint = os.Getenv("OTEL_EXPORTER_OTLP_PROFILES_ENDPOINT")
	}
	if endpoint == "" {
		if base := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"); base != "" {
			endpoint = strings.TrimRight(base, "/") + profilesPath
		}
	}
	if endpoint == "" {
		return resolved{}, errors.New("profiler: no endpoint, set Config.Endpoint or OTEL_EXPORTER_OTLP_ENDPOINT")
	}

	headers := parseList(os.Getenv("OTEL_EXPORTER_OTLP_HEADERS"))
	for k, v := range parseList(os.Getenv("OTEL_EXPORTER_OTLP_PROFILES_HEADERS")) {
		headers[k] = v
	}
	for k, v := range cfg.Headers {
		headers[k] = v
	}

	resource := parseList(os.Getenv("OTEL_RESOURCE_ATTRIBUTES"))
	for k, v := range cfg.ResourceAttributes {
		resource[k] = v
	}
	if name := firstNonEmpty(cfg.ServiceName, os.Getenv("OTEL_SERVICE_NAME")); name != "" {
		resource["service.name"] = name
	}
	if resource["service.name"] == "" {
		resource["service.name"] = "unknown_service:" + executableName()
	}
	resource["process.runtime.name"] = "go"
	resource["process.runtime.version"] = runtime.Version()
	resource["telemetry.sdk.language"] = "go"

	interval := cfg.Interval
	if interval <= 0 {
		interval = defaultInterval
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return resolved{endpoint: endpoint, headers: headers, resource: resource, interval: interval, client: client}, nil
}

// parseList reads the key1=value1,key2=value2 format the OTel environment
// variables use, with percent-encoded values.
func parseList(s string) map[string]string {
	out := map[string]string{}
	for _, pair := range strings.Split(s, ",") {
		k, v, ok := strings.Cut(pair, "=")
		k = strings.TrimSpace(k)
		if !ok || k == "" {
			continue
		}
		if decoded, err := url.PathUnescape(strings.TrimSpace(v)); err == nil {
			v = decoded
		}
		out[k] = strings.TrimSpace(v)
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func executableName() string {
	exe, err := os.Executable()
	if err != nil {
		return "go"
	}
	return filepath.Base(exe)
}
