package profiler

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"runtime/pprof"
	"testing"
	"time"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	pb "go.opentelemetry.io/proto/otlp/profiles/v1development"
	"google.golang.org/protobuf/proto"
)

var sink [][]byte

func TestProfilerExportsCPUAndHeapLinkedToSpans(t *testing.T) {
	requests := make(chan *http.Request, 4)
	bodies := make(chan *pb.ProfilesData, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		zr, err := gzip.NewReader(r.Body)
		if err != nil {
			t.Errorf("body is not gzip: %v", err)
			return
		}
		raw, _ := io.ReadAll(zr)
		var req pb.ProfilesData
		if err := proto.Unmarshal(raw, &req); err != nil {
			t.Errorf("body is not an OTLP profiles request: %v", err)
		}
		requests <- r
		bodies <- &req
	}))
	defer server.Close()

	p, err := Start(Config{
		Endpoint:    server.URL + "/v1development/profiles",
		Headers:     map[string]string{"Authorization": "Bearer test-key"},
		ServiceName: "checkout",
		Interval:    time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}

	tracer := TracerProvider(sdktrace.NewTracerProvider()).Tracer("test")
	ctx, span := tracer.Start(context.Background(), "burn")
	pprof.Do(ctx, pprof.Labels("endpoint", "/checkout"), func(context.Context) {
		deadline := time.Now().Add(500 * time.Millisecond)
		for time.Now().Before(deadline) {
			sink = append(sink, make([]byte, 64<<10))
			if len(sink) > 256 {
				sink = sink[:0]
			}
		}
	})
	span.End()
	runtime.GC()

	if err := p.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}

	r := <-requests
	req := <-bodies
	if r.URL.Path != "/v1development/profiles" || r.Header.Get("Authorization") != "Bearer test-key" {
		t.Fatalf("request = %s %v", r.URL.Path, r.Header)
	}

	d := req.Dictionary
	text := func(i int32) string { return d.StringTable[i] }
	resource := map[string]string{}
	for _, kv := range req.ResourceProfiles[0].Resource.Attributes {
		resource[kv.Key] = kv.Value.GetStringValue()
	}
	if resource["service.name"] != "checkout" {
		t.Fatalf("resource = %v", resource)
	}

	types := map[string]string{}
	linked := false
	labeled := false
	traceID, spanID := span.SpanContext().TraceID(), span.SpanContext().SpanID()
	for _, prof := range req.ResourceProfiles[0].ScopeProfiles[0].Profiles {
		types[text(prof.SampleType.TypeStrindex)] = text(prof.SampleType.UnitStrindex)
		if text(prof.SampleType.TypeStrindex) != "cpu" {
			continue
		}
		for _, s := range prof.Samples {
			link := d.LinkTable[s.LinkIndex]
			if bytes.Equal(link.TraceId, traceID[:]) && bytes.Equal(link.SpanId, spanID[:]) {
				linked = true
			}
			if sampleAttrs(d, s)["endpoint"] == "/checkout" {
				labeled = true
			}
		}
	}
	want := map[string]string{
		"cpu": "nanoseconds", "samples": "count",
		"inuse_space": "bytes", "inuse_objects": "count",
		"alloc_space": "bytes", "alloc_objects": "count",
	}
	for typ, unit := range want {
		if types[typ] != unit {
			t.Errorf("sample type %s = %q, want %q (got %v)", typ, types[typ], unit, types)
		}
	}
	if !linked {
		t.Error("no CPU sample links to the span that was active")
	}
	if !labeled {
		t.Error("no CPU sample carries the pprof.Do label")
	}
}

func TestUnsampledSpanAddsNoLabels(t *testing.T) {
	tp := sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.NeverSample()))
	ctx, span := TracerProvider(tp).Tracer("test").Start(context.Background(), "skipped")
	defer span.End()

	if _, ok := pprof.Label(ctx, spanIDLabel); ok {
		t.Fatal("unsampled span must not label the goroutine")
	}
}

func TestStartWithoutEndpointFails(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	t.Setenv("OTEL_EXPORTER_OTLP_PROFILES_ENDPOINT", "")
	if _, err := Start(Config{}); err == nil {
		t.Fatal("Start must fail without an endpoint")
	}
}

func TestResolveFromEnvironment(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://ingest.example.com/")
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Bearer%20secret")
	t.Setenv("OTEL_SERVICE_NAME", "api")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment.name=prod")

	r, err := resolve(Config{})
	if err != nil {
		t.Fatal(err)
	}
	if r.endpoint != "https://ingest.example.com/v1development/profiles" {
		t.Errorf("endpoint = %s", r.endpoint)
	}
	if r.headers["Authorization"] != "Bearer secret" {
		t.Errorf("headers = %v", r.headers)
	}
	if r.resource["service.name"] != "api" || r.resource["deployment.environment.name"] != "prod" {
		t.Errorf("resource = %v", r.resource)
	}
}
