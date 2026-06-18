#[test]
fn tauri_runtime_registers_backend_telemetry_and_relay() {
    let lib = include_str!("../src/lib.rs");
    let otel = include_str!("../src/otel.rs");

    assert!(lib.contains("pub mod otel;"));
    assert!(lib.contains("otel::init_telemetry"));
    assert!(lib.contains(".manage(otlp_proxy)"));
    assert!(lib.contains(".manage(telemetry_context.clone())"));
    assert!(lib.contains("otel::proxy_otlp"));
    assert!(lib.contains("otel::get_telemetry_context"));
    assert!(lib.contains("otel::log_app_started"));
    assert!(lib.contains("otel::log_app_stopped"));
    assert!(otel.contains("everr.app.started"));
    assert!(otel.contains("everr.app.stopped"));
    assert!(!otel.contains("desktop.app.started"));
    assert!(!otel.contains("desktop.app.stopped"));
}

#[test]
fn cargo_manifest_declares_backend_telemetry_dependencies() {
    let manifest = include_str!("../Cargo.toml");

    for dependency in [
        "opentelemetry",
        "opentelemetry_sdk",
        "opentelemetry-otlp",
        "opentelemetry-appender-tracing",
        "tracing-subscriber",
        "uuid",
    ] {
        assert!(
            manifest.contains(dependency),
            "missing dependency {dependency}"
        );
    }

    assert!(!manifest.contains("tracing-opentelemetry"));
    assert!(!manifest.contains("\"metrics\""));
    assert!(!manifest.contains("\"trace\""));
}

#[test]
fn backend_telemetry_defaults_to_info_when_rust_log_is_absent() {
    let otel = include_str!("../src/otel.rs");

    assert!(otel.contains("default_telemetry_filter"));
    assert!(otel.contains("EnvFilter::try_from_default_env"));
    assert!(otel.contains("EnvFilter::new(\"info\")"));
}

#[test]
fn backend_logs_directly_and_proxies_browser_otlp() {
    let otel = include_str!("../src/otel.rs");
    let build = include_str!("../build.rs");

    // Rust's own telemetry exports directly through the SDK log pipeline.
    assert!(otel.contains("SdkLoggerProvider"));
    assert!(otel.contains("LogExporter::builder()"));
    assert!(otel.contains("service.version"));
    assert!(otel.contains("service.instance.id"));
    assert!(otel.contains("Uuid::new_v4"));
    assert!(otel.contains("get_telemetry_context"));
    assert!(otel.contains("\"logs\""));

    // Browser telemetry is forwarded as opaque OTLP/JSON, not reconstructed.
    assert!(otel.contains("pub async fn proxy_otlp"));
    assert!(otel.contains("struct OtlpProxy"));
    assert!(otel.contains("application/json"));
    assert!(otel.contains("matches!(signal.as_str(), \"logs\" | \"traces\" | \"metrics\")"));
    assert!(!otel.contains("BrowserLogRecord"));
    assert!(!otel.contains("create_log_record"));
    assert!(!otel.contains("set_trace_context"));
    assert!(!otel.contains("build_browser_span_data"));

    assert!(otel.contains("option_env!(\"EVERR_INGEST_KEY\")"));
    assert!(otel.contains("https://ingest.everr.dev"));
    assert!(otel.contains("Authorization"));
    assert!(otel.contains("Bearer {key}"));
    assert!(build.contains("cargo:rerun-if-env-changed=EVERR_INGEST_KEY"));
    assert!(!otel.contains("SpanExporter::builder()"));
    assert!(!otel.contains("MetricExporter::builder()"));
    assert!(!otel.contains("tracing_opentelemetry"));
}

#[test]
fn collector_sidecar_emits_namespaced_status_logs() {
    let sidecar = include_str!("../src/telemetry/sidecar.rs");

    for expected in [
        "collector_status_event_name",
        "everr.collector.status.running",
        "everr.collector.status.failed",
        "everr.collector.status.stopped",
        "everr.collector.previous_status",
        "everr.collector.status",
        "exception.type",
        "exception.message",
        "CollectorExitError",
    ] {
        assert!(
            sidecar.contains(expected),
            "missing collector telemetry marker {expected}"
        );
    }

    assert!(!sidecar.contains("should_log_collector_status"));
    assert!(!sidecar.contains("\"collector.status.running\""));
    assert!(!sidecar.contains("\"collector.status.failed\""));
    assert!(!sidecar.contains("\"collector.status.stopped\""));
    assert!(!sidecar.contains("target: \"collector\""));
    assert!(!sidecar.contains("collector.status = \"starting\""));
    assert!(!sidecar.contains("collector.status.changed"));
}

#[test]
fn rust_network_telemetry_is_removed_from_tauri_backend() {
    let manifest = include_str!("../Cargo.toml");
    let otel = include_str!("../src/otel.rs");
    let query = include_str!("../src/telemetry/query.rs");

    assert!(
        !manifest.contains("features = [ \"otel\" ]"),
        "tauri backend should not enable everr-core otel feature"
    );
    // The backend's own telemetry still goes through the SDK exporter, not raw
    // HTTP. The only direct HTTP from otel.rs is the OTLP passthrough proxy that
    // forwards already-encoded browser telemetry.
    assert!(!otel.contains("http_telemetry::send"));
    assert!(!query.contains("http_telemetry::send"));
}

#[test]
fn rust_errors_emit_exception_logs() {
    let crash_log = include_str!("../src/crash_log.rs");
    let notifications = include_str!("../src/notifications.rs");

    assert!(crash_log.contains("everr.rust.error"));
    assert!(!crash_log.contains("desktop.rust.error"));
    assert!(!crash_log.contains("event.name = \"rust.error\""));
    assert!(crash_log.contains("exception.type"));
    assert!(crash_log.contains("exception.message"));
    assert!(crash_log.contains("exception.stacktrace"));
    assert!(crash_log.contains("error.handled"));
    assert!(notifications.contains("log_notifier_sse_reconnect"));
    assert!(notifications.contains("everr.notifier.sse.reconnect"));
    assert!(!notifications.contains("log_error(\"notifier SSE\""));
    assert!(!notifications.contains("log_error(\"notifier SSE auth\""));
}

#[test]
fn successful_app_updates_emit_namespaced_execution_log() {
    let startup = include_str!("../src/startup.rs");

    for expected in [
        "everr.app.update.executed",
        "everr.app.update.current_version",
        "everr.app.update.version",
        "everr.app.update.target",
        "log_app_update_executed(&update)",
    ] {
        assert!(
            startup.contains(expected),
            "missing app update telemetry marker {expected}"
        );
    }

    assert!(!startup.contains("\"app.update.executed\""));
    assert!(!startup.contains("target: \"app.update\""));
}
