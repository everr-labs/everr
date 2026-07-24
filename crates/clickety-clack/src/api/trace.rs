//! Per-request server span for the HTTP API. Span name is `{METHOD} {route}`
//! (the MATCHED pattern, e.g. "GET /v1/rules/:id", never the raw path: raw
//! paths would explode cardinality and can embed identifiers). Inbound W3C
//! `traceparent` is honored as the parent, so app -> engine requests join one
//! trace. Applied outermost: health probes are covered too (ship everything).

use axum::extract::{MatchedPath, Request};
use axum::middleware::Next;
use axum::response::Response;
use opentelemetry::propagation::Extractor;
use tracing::field::Empty;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// Adapter: read W3C context headers off the request for the propagator.
struct HeaderExtractor<'a>(&'a axum::http::HeaderMap);

impl Extractor for HeaderExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|v| v.to_str().ok())
    }
    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|k| k.as_str()).collect()
    }
}

pub async fn trace_request(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|p| p.as_str().to_owned())
        .unwrap_or_else(|| req.uri().path().to_owned());
    let span = tracing::info_span!(
        "http.request",
        otel.name = format!("{method} {route}"),
        otel.kind = "server",
        http.request.method = %method,
        http.route = %route,
        http.response.status_code = Empty,
        otel.status_code = Empty,
        otel.status_message = Empty,
    );
    let parent = opentelemetry::global::get_text_map_propagator(|p| {
        p.extract(&HeaderExtractor(req.headers()))
    });
    span.set_parent(parent);

    async move {
        let res = next.run(req).await;
        let status = res.status();
        tracing::Span::current().record("http.response.status_code", status.as_u16());
        if status.is_server_error() {
            crate::otel::span_error(&format!("http status {status}"));
        }
        res
    }
    .instrument(span)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;
    use axum::Router;
    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use tower::util::ServiceExt;
    use tracing_subscriber::layer::SubscriberExt;

    fn test_router() -> Router {
        Router::new()
            .route("/v1/rules/:id", get(|| async { "ok" }))
            .route(
                "/boom",
                get(|| async { axum::http::StatusCode::INTERNAL_SERVER_ERROR }),
            )
            .layer(axum::middleware::from_fn(trace_request))
    }

    async fn run_with_exporter<F, Fut>(f: F) -> Vec<opentelemetry_sdk::trace::SpanData>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let exporter = InMemorySpanExporter::default();
        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
        let _guard = tracing::subscriber::set_default(subscriber);
        f().await;
        provider.force_flush().unwrap();
        exporter.get_finished_spans().unwrap()
    }

    #[tokio::test]
    async fn request_span_uses_matched_route_and_status() {
        let spans = run_with_exporter(|| async {
            let res = test_router()
                .oneshot(
                    axum::http::Request::builder()
                        .uri("/v1/rules/1234")
                        .body(axum::body::Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(res.status(), axum::http::StatusCode::OK);
        })
        .await;
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].name, "GET /v1/rules/:id");
        assert!(spans[0]
            .attributes
            .iter()
            .any(|kv| kv.key.as_str() == "http.route" && kv.value.as_str() == "/v1/rules/:id"));
    }

    #[tokio::test]
    async fn inbound_traceparent_becomes_the_parent() {
        opentelemetry::global::set_text_map_propagator(
            opentelemetry_sdk::propagation::TraceContextPropagator::new(),
        );
        let spans = run_with_exporter(|| async {
            let _ = test_router()
                .oneshot(
                    axum::http::Request::builder()
                        .uri("/v1/rules/1")
                        .header(
                            "traceparent",
                            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
                        )
                        .body(axum::body::Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
        })
        .await;
        assert_eq!(
            spans[0].span_context.trace_id().to_string(),
            "0af7651916cd43dd8448eb211c80319c"
        );
    }

    #[tokio::test]
    async fn server_errors_mark_the_span() {
        let spans = run_with_exporter(|| async {
            let _ = test_router()
                .oneshot(
                    axum::http::Request::builder()
                        .uri("/boom")
                        .body(axum::body::Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
        })
        .await;
        assert!(matches!(
            spans[0].status,
            opentelemetry::trace::Status::Error { .. }
        ));
    }
}
