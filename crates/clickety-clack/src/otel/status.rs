//! Helpers for marking failed spans with OpenTelemetry error status.

/// Mark the current span as errored. The enclosing span must declare
/// `otel.status_code` and `otel.status_message` as empty fields.
pub fn span_error(err: &dyn std::fmt::Display) {
    let span = tracing::Span::current();
    span.record("otel.status_code", "ERROR");
    span.record("otel.status_message", tracing::field::display(err));
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentelemetry::trace::{Status, TracerProvider as _};
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use tracing_subscriber::layer::SubscriberExt;

    #[test]
    fn span_error_sets_otel_error_status() {
        let exporter = InMemorySpanExporter::default();
        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
        tracing::subscriber::with_default(subscriber, || {
            let span = tracing::info_span!(
                "op",
                otel.status_code = tracing::field::Empty,
                otel.status_message = tracing::field::Empty
            );
            let _g = span.enter();
            span_error(&"boom");
        });
        provider.force_flush().unwrap();
        let spans = exporter.get_finished_spans().unwrap();
        assert_eq!(spans.len(), 1);
        match &spans[0].status {
            Status::Error { description } => assert!(description.contains("boom")),
            other => panic!("expected error status, got {other:?}"),
        }
    }
}
