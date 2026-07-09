//! The SSE stream (`/v1/events/stream`) must still deliver suppressed (preview-rule)
//! events: suppression mutes notifications, not visibility. The UI streams them.

use axum::body::Body;
use axum::http::Request;
use cc::api::auth::HeaderAuth;
use cc::api::{build_router, AppState};
use cc::clickhouse::ChClient;
use cc::crypto::EnvKeyring;
use cc::domain::event::EventStatus;
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::rule::Severity;
use cc::domain::Event;
use cc::stores::PgStore;
use http_body_util::BodyExt;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn sse_stream_delivers_suppressed_events() {
    let pg_url = crate::support::fresh_db().await;
    let store = PgStore::connect(&pg_url).await.unwrap();
    let (events_tx, _rx) = tokio::sync::broadcast::channel::<Event>(16);
    let state = AppState {
        store,
        ch: ChClient::new(
            "http://127.0.0.1:1",
            cc::clickhouse::build_ch_auth("shared", "default", "", None, None, "", None).unwrap(),
        ),
        auth: Arc::new(HeaderAuth),
        cipher: Arc::new(
            EnvKeyring::new(
                HashMap::from([("v1".to_string(), [7u8; 32])]),
                "v1".to_string(),
            )
            .unwrap(),
        ),
        events_tx: events_tx.clone(),
        allow_private_webhooks: false,
    };
    let app = build_router(state);

    let tenant = Uuid::new_v4();
    let resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/events/stream")
                .header("X-CC-Tenant", tenant.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // Broadcast a suppressed event for this tenant AFTER the stream is subscribed.
    let mut ev = Event::new(
        TenantId::from_trusted(tenant.to_string()),
        RuleId(Uuid::nil()),
        InstanceKey("k1".into()),
        EventStatus::Firing,
        BTreeMap::from([("host".to_string(), "web-1".to_string())]),
        Some(7.0),
        Severity::Warning,
        BTreeMap::new(),
        time::OffsetDateTime::UNIX_EPOCH,
    );
    ev.suppressed = true;
    ev.evidence = Some(BTreeMap::from([(
        "errors".to_string(),
        serde_json::json!(7.0),
    )]));
    events_tx.send(ev).unwrap();

    // The first SSE frame must be the suppressed event, evidence included.
    let mut body = resp.into_body();
    let frame = tokio::time::timeout(std::time::Duration::from_secs(5), body.frame())
        .await
        .expect("SSE frame within 5s")
        .expect("stream not ended")
        .expect("frame ok");
    let bytes = frame.into_data().expect("data frame");
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    let json_start = text.find("data: ").expect("SSE data line") + "data: ".len();
    let payload: serde_json::Value = serde_json::from_str(text[json_start..].trim_end()).unwrap();
    assert_eq!(
        payload["suppressed"], true,
        "SSE must deliver suppressed events (payload: {payload})"
    );
    assert_eq!(payload["evidence"]["errors"], 7.0);
    assert_eq!(payload["evidence_truncated"], false);
}
