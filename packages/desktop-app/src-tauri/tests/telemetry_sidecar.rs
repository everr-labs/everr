//! Integration test for the collector sidecar supervisor.
//!
//! Gated on the collector binary being present under
//! `target/desktop-sidecars/`. If missing, the test skips with a clear
//! message (run `pnpm desktop:prepare:debug` to produce it).

use std::path::PathBuf;
use std::time::Duration;

use everr_app_lib::telemetry::sidecar::{
    spawn_collector_detached, wait_for_disabled_state, TelemetryState,
};
use tempfile::TempDir;

fn collector_path() -> Option<PathBuf> {
    let triple = format!("{}-apple-darwin", std::env::consts::ARCH);
    let mut cursor = std::env::current_exe().ok()?;
    while cursor.pop() {
        let candidate = cursor
            .join("desktop-sidecars")
            .join(format!("everr-local-collector-{triple}"));
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[tokio::test]
async fn spawn_collector_reaches_ready_and_shuts_down() {
    let Some(binary) = collector_path() else {
        eprintln!(
            "skipping: collector binary not found under target/desktop-sidecars/. \
             Run `pnpm desktop:prepare:debug` to build it."
        );
        return;
    };
    let tmp = TempDir::new().expect("tempdir");
    let handle = spawn_collector_detached(&binary, tmp.path())
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
