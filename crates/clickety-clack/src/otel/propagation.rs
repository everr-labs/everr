//! W3C traceparent helpers for crossing the Redis stream: the evaluator stamps
//! the emitting span's context onto the event envelope; the dispatcher parses
//! it back into a SpanContext and attaches it as a span LINK (a group flush
//! batches many events; links are the correct many-to-one semantics).

use opentelemetry::trace::{SpanContext, SpanId, TraceFlags, TraceId, TraceState};
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// The current span's W3C traceparent, or None when there is no
/// sampled/recording span context (e.g. telemetry disabled).
pub fn current_traceparent() -> Option<String> {
    let cx = tracing::Span::current().context();
    let binding = opentelemetry::trace::TraceContextExt::span(&cx);
    let sc = binding.span_context();
    if !sc.is_valid() {
        return None;
    }
    Some(format!(
        "00-{}-{}-{:02x}",
        sc.trace_id(),
        sc.span_id(),
        sc.trace_flags().to_u8()
    ))
}

/// Parse a W3C traceparent into a remote SpanContext. Returns None on any
/// malformed input: a bad header must never break event processing.
pub fn span_context_from_traceparent(tp: &str) -> Option<SpanContext> {
    let mut parts = tp.split('-');
    let version = parts.next()?;
    if version != "00" {
        return None;
    }
    let trace_id = TraceId::from_hex(parts.next()?).ok()?;
    let span_id = SpanId::from_hex(parts.next()?).ok()?;
    let flags = u8::from_str_radix(parts.next()?, 16).ok()?;
    if parts.next().is_some() {
        return None;
    }
    let sc = SpanContext::new(
        trace_id,
        span_id,
        TraceFlags::new(flags),
        true, // remote
        TraceState::default(),
    );
    sc.is_valid().then_some(sc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_valid_traceparent() {
        let tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
        let sc = span_context_from_traceparent(tp).expect("valid");
        assert_eq!(
            sc.trace_id().to_string(),
            "0af7651916cd43dd8448eb211c80319c"
        );
        assert_eq!(sc.span_id().to_string(), "b7ad6b7169203331");
        assert!(sc.is_remote());
        assert!(sc.trace_flags().is_sampled());
    }

    #[test]
    fn rejects_malformed_traceparents() {
        for bad in [
            "",
            "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01", // version
            "00-zzz-b7ad6b7169203331-01",                              // bad trace id
            "00-00000000000000000000000000000000-b7ad6b7169203331-01", // zero trace id
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01-extra",
        ] {
            assert!(span_context_from_traceparent(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn no_active_span_yields_none() {
        // Run under a bare (no OpenTelemetry layer) subscriber via
        // `with_default` rather than relying on ambient process state: tests
        // run in one process (threaded), and another test elsewhere may have
        // installed a global default subscriber with an otel layer, which
        // would make this flaky if we just asserted against whatever is
        // ambient.
        let subscriber = tracing_subscriber::registry();
        tracing::subscriber::with_default(subscriber, || {
            assert_eq!(current_traceparent(), None);
        });
    }
}
