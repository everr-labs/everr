//! Integration test for the collector sidecar supervisor.
//!
//! Gated on the bundled CLI binary being present under
//! `target/desktop-resources/`. If missing, the test skips with a clear
//! message (run `pnpm desktop:prepare:debug` to produce it).

use std::net::TcpListener;
use std::path::PathBuf;
use std::time::Duration;

use everr_app_lib::telemetry::sidecar::{
    spawn_cli_collector_detached, wait_for_disabled_state, TelemetryState, COLLECTOR_START_ARGS,
};
use everr_core::build::HEALTHCHECK_PORT;
use tempfile::TempDir;

fn cli_path() -> Option<PathBuf> {
    let mut cursor = std::env::current_exe().ok()?;
    while cursor.pop() {
        let candidate = cursor.join("desktop-resources").join("everr");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[test]
fn sidecar_invokes_local_start_command() {
    assert_eq!(COLLECTOR_START_ARGS, ["local", "start", "--quiet"]);
}

#[tokio::test]
async fn spawn_collector_reaches_ready_and_shuts_down() {
    let Some(binary) = cli_path() else {
        eprintln!(
            "skipping: bundled CLI not found under target/desktop-resources/. \
             Run `pnpm desktop:prepare:debug` to build it."
        );
        return;
    };
    if !health_port_is_free() {
        eprintln!("skipping: telemetry health port {HEALTHCHECK_PORT} is already in use");
        return;
    }

    let tmp = TempDir::new().expect("tempdir");
    let telemetry_dir = tmp.path().join("telemetry");
    let handle = spawn_cli_collector_detached(&binary, &telemetry_dir)
        .await
        .expect("spawn");
    let state = handle.wait_ready().await;
    assert!(matches!(state, TelemetryState::Ready { .. }));

    // POST a minimal OTLP traces payload so the file exporter actually writes.
    let endpoint = match state {
        TelemetryState::Ready { ref otlp_endpoint } => otlp_endpoint.clone(),
        _ => unreachable!(),
    };
    let resp = reqwest::Client::new()
        .post(format!("{endpoint}/v1/traces"))
        .header("content-type", "application/json")
        .body(r#"{"resourceSpans":[]}"#)
        .send()
        .await
        .expect("send OTLP");
    assert!(resp.status().is_success());

    handle.shutdown().await;

    assert!(telemetry_dir.join("chdb").exists());
}

#[tokio::test]
async fn wait_for_disabled_state_returns_after_state_changes() {
    let (tx, rx) = tokio::sync::watch::channel(TelemetryState::Starting);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let _ = tx.send(TelemetryState::Disabled {
            reason: "test".into(),
        });
    });

    let started = tokio::time::Instant::now();
    let disabled = wait_for_disabled_state(rx, Duration::from_secs(1)).await;

    assert!(disabled, "expected helper to observe disabled state");
    assert!(
        started.elapsed() < Duration::from_millis(500),
        "helper should return soon after the state changes"
    );
}

fn health_port_is_free() -> bool {
    TcpListener::bind(("127.0.0.1", HEALTHCHECK_PORT)).is_ok()
}
