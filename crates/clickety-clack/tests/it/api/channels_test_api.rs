//! POST /v1/channel-tests: the draft-channel test the builder calls.
use crate::api::support::{body_json, state_with_notifiers, FakeNotifier, TENANT};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::api::build_router;
use cc::dispatcher::{Notifier, NotifyError};
use cc::domain::channel::ChannelConfig;
use std::sync::Arc;
use tower::ServiceExt;

fn req(body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/v1/channel-tests")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", TENANT)
        .body(Body::from(body.to_string()))
        .unwrap()
}

const SLACK: &str = r#"{"config":{"type":"slack","url":"https://hooks.slack.com/services/T/B/x"}}"#;

#[tokio::test]
async fn a_delivered_test_reports_ok() {
    let fake = Arc::new(FakeNotifier::new("slack"));
    let app = build_router(state_with_notifiers(vec![fake.clone() as Arc<dyn Notifier>]).await);

    let resp = app.oneshot(req(SLACK)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["ok"], true);
    assert!(body["latency_ms"].is_number());
    assert!(body["error"].is_null());

    // It actually sent, with the config the caller supplied.
    let expected_url = serde_json::from_str::<serde_json::Value>(SLACK).unwrap()["config"]["url"]
        .as_str()
        .unwrap()
        .to_string();
    let sent = fake.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    match &sent[0].0 {
        ChannelConfig::Slack { url } => assert_eq!(url, &expected_url),
        other => panic!("expected Slack config, got {other:?}"),
    }
}

#[tokio::test]
async fn a_refused_delivery_is_200_with_ok_false_not_a_5xx() {
    // The request succeeded; the delivery did not. The builder wants to render
    // the provider's own message, and a client must be able to tell "your
    // request was wrong" from "your channel is wrong" without parsing a body.
    let fake = Arc::new(FakeNotifier::failing(
        "slack",
        NotifyError::Permanent("401 invalid_token".into()),
    ));
    let app = build_router(state_with_notifiers(vec![fake as Arc<dyn Notifier>]).await);

    let resp = app.oneshot(req(SLACK)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["ok"], false);
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("401 invalid_token"));
}

#[tokio::test]
async fn a_private_url_is_rejected_by_the_shared_guard() {
    // Proves Task 1's split kept the SSRF guard on this path.
    let fake = Arc::new(FakeNotifier::new("webhook"));
    let app = build_router(state_with_notifiers(vec![fake.clone() as Arc<dyn Notifier>]).await);

    let resp = app
        .oneshot(req(
            r#"{"config":{"type":"webhook","url":"http://127.0.0.1:9/hook"}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    // Rejected before any outbound request.
    assert!(fake.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_empty_recipient_list_is_ok_false_not_a_422() {
    // validate_channel checks duplicates, not emptiness; the notifier catches
    // it at send time as Permanent. Pinning the boundary so it cannot drift.
    let fake = Arc::new(FakeNotifier::failing(
        "email",
        NotifyError::Permanent("no recipients".into()),
    ));
    let app = build_router(state_with_notifiers(vec![fake as Arc<dyn Notifier>]).await);

    let resp = app
        .oneshot(req(r#"{"config":{"type":"email","to":[]}}"#))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["ok"], false);
    assert!(body["error"].as_str().unwrap().contains("no recipients"));
}

#[tokio::test]
async fn an_unregistered_kind_reports_rather_than_panicking() {
    // An api node with no CC_SMTP_HOST has no email notifier registered.
    let app = build_router(state_with_notifiers(Vec::new()).await);

    let resp = app
        .oneshot(req(r#"{"config":{"type":"email","to":["a@b.com"]}}"#))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["ok"], false);
    assert!(body["error"].as_str().unwrap().contains("not configured"));
}
