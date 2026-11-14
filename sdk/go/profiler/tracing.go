package profiler

import (
	"context"
	"runtime/pprof"

	"go.opentelemetry.io/otel/trace"
)

// TracerProvider wraps tp so that while a sampled span is active on a
// goroutine, the goroutine carries trace_id and span_id pprof labels. CPU
// samples taken under those labels are exported with a link to the span.
// Goroutines started inside the span inherit the labels.
//
// End must be called on the goroutine that started the span: it restores the
// labels the goroutine had before the span started.
//
//	otel.SetTracerProvider(profiler.TracerProvider(sdkTracerProvider))
func TracerProvider(tp trace.TracerProvider) trace.TracerProvider {
	return &tracerProvider{TracerProvider: tp}
}

type tracerProvider struct {
	trace.TracerProvider
}

func (p *tracerProvider) Tracer(name string, opts ...trace.TracerOption) trace.Tracer {
	return &tracer{Tracer: p.TracerProvider.Tracer(name, opts...)}
}

type tracer struct {
	trace.Tracer
}

func (t *tracer) Start(parent context.Context, name string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	ctx, span := t.Tracer.Start(parent, name, opts...)
	sc := span.SpanContext()
	// An unsampled span is never exported, so a link to it would dangle.
	if !sc.IsValid() || !sc.IsSampled() {
		return ctx, span
	}
	ctx = pprof.WithLabels(ctx, pprof.Labels(traceIDLabel, sc.TraceID().String(), spanIDLabel, sc.SpanID().String()))
	pprof.SetGoroutineLabels(ctx)
	labeled := &labeledSpan{Span: span, parent: parent}
	return trace.ContextWithSpan(ctx, labeled), labeled
}

type labeledSpan struct {
	trace.Span
	parent context.Context
}

func (s *labeledSpan) End(opts ...trace.SpanEndOption) {
	s.Span.End(opts...)
	pprof.SetGoroutineLabels(s.parent)
}
