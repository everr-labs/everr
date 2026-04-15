use std::sync::Mutex;

use everr_app_lib::telemetry::bridge::{install, BridgeHandle};
use everr_app_lib::telemetry::sidecar::TelemetryState;
use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;
use prost::Message;
use tokio::sync::watch;
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Tests share a global OTel subscriber (OnceLock) and must not run in parallel.
static SERIAL: Mutex<()> = Mutex::new(());

#[tokio::test]
async fn install_with_disabled_state_does_not_panic_on_tracing_calls() {
    let _lock = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let (_tx, rx) = watch::channel(TelemetryState::Disabled {
        reason: "test".into(),
    });
    let handle: BridgeHandle = install(rx);
    tracing::info!("hello from the disabled path");
    tracing::info_span!("hello.span").in_scope(|| {
        tracing::warn!("inside a span");
    });
    handle.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn install_with_ready_state_exports_traces_to_mock() {
    let _lock = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1..)
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1/traces", server.uri());

    let (tx, rx) = watch::channel(TelemetryState::Starting);

    let handle: BridgeHandle = install(rx);

    // Send Ready state after install so the watch task sees a change.
    tx.send(TelemetryState::Ready {
        otlp_endpoint: endpoint,
    })
    .expect("send Ready state");

    // Give the watch task time to wire providers.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let span = tracing::info_span!("test.trace_export");
    let _guard = span.enter();
    tracing::info!("event inside span for trace export");
    drop(_guard);

    handle.shutdown().await;
    // wiremock's `.expect(1..)` assertion runs on server drop
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn install_with_ready_state_exports_logs_with_trace_correlation() {
    let _lock = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1..)
        .mount(&server)
        .await;

    let endpoint = format!("{}/v1/logs", server.uri());
    let (tx, rx) = watch::channel(TelemetryState::Starting);

    let handle: BridgeHandle = install(rx);

    // Send Ready state after install so the watch task sees a change.
    tx.send(TelemetryState::Ready {
        otlp_endpoint: endpoint,
    })
    .expect("send Ready state");

    // Give the watch task time to wire providers.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let span = tracing::info_span!("test.log_correlation");
    let _guard = span.enter();
    tracing::info!("correlated log event");
    drop(_guard);

    handle.shutdown().await;

    // Inspect the received requests for log correlation.
    let requests = server.received_requests().await.expect("recorded requests");

    // Find a request that decodes as an ExportLogsServiceRequest with log records.
    let log_request = requests
        .iter()
        .find(|r| {
            r.headers.get("content-type").and_then(|v| v.to_str().ok())
                == Some("application/x-protobuf")
                && ExportLogsServiceRequest::decode(r.body.as_slice())
                    .ok()
                    .map_or(false, |req| {
                        req.resource_logs
                            .iter()
                            .any(|rl| rl.scope_logs.iter().any(|sl| !sl.log_records.is_empty()))
                    })
        })
        .expect("expected a request containing log records");

    assert_eq!(
        log_request
            .headers
            .get("content-type")
            .expect("content-type header")
            .to_str()
            .unwrap(),
        "application/x-protobuf",
        "OTLP logs should be sent as protobuf"
    );

    let export_req = ExportLogsServiceRequest::decode(log_request.body.as_slice())
        .expect("failed to decode ExportLogsServiceRequest");

    let has_correlated_log = export_req.resource_logs.iter().any(|rl| {
        rl.scope_logs.iter().any(|sl| {
            sl.log_records
                .iter()
                .any(|lr| !lr.trace_id.is_empty() && !lr.span_id.is_empty())
        })
    });

    assert!(
        has_correlated_log,
        "at least one log record should have non-empty trace_id and span_id"
    );
}
