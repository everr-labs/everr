use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::api::auth::HeaderAuth;
use cc::api::{build_router, AppState};
use cc::clickhouse::ChClient;
use cc::crypto::EnvKeyring;
use cc::domain::Event;
use cc::stores::PgStore;
use std::collections::HashMap;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

async fn setup() -> axum::Router {
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
        events_tx,
        allow_private_webhooks: false,
    };
    build_router(state)
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn req(method: &str, uri: &str, tenant: Uuid, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// Create the named channels the receiver tests reference.
async fn seed_channels(app: &axum::Router, tenant: Uuid) {
    for body in [
        r#"{"name":"plain-hook","config":{"type":"webhook","url":"http://x/h"}}"#,
        r#"{"name":"team-slack","config":{"type":"slack","url":"https://hooks.slack/SECRET"}}"#,
    ] {
        let resp = app
            .clone()
            .oneshot(req("POST", "/v1/channels", tenant, body))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}

#[tokio::test]
async fn channels_crud_redaction_and_referenced_delete_conflict() {
    let app = setup().await;
    let tenant = Uuid::new_v4();

    // Create; the response redacts the secret but keeps the type.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/channels",
            tenant,
            r#"{"name":"team-slack","config":{"type":"slack","url":"https://hooks.slack/SECRET"}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["name"], "team-slack");
    assert_eq!(v["config"]["type"], "slack");
    assert_eq!(v["config"]["url"], "***", "secret redacted on create");

    // GET and list redact too.
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/channels/team-slack", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["config"]["url"], "***");
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/channels", tenant, ""))
        .await
        .unwrap();
    let list = body_json(resp).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["config"]["url"], "***");

    // Deleting while a receiver references it is a 409 naming the referrer.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"oncall","channels":["team-slack"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/channels/team-slack", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let v = body_json(resp).await;
    assert_eq!(v["detail"], "channel is referenced by receivers: oncall");

    // Drop the receiver; the delete goes through, then 404s.
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/channels/team-slack", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/channels/team-slack", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn receiver_with_unknown_channels_is_rejected_naming_them() {
    let app = setup().await;
    let tenant = Uuid::new_v4();
    seed_channels(&app, tenant).await;

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"oncall","channels":["team-slack","nope-1","nope-2"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let v = body_json(resp).await;
    assert_eq!(v["detail"], "unknown channels: nope-1, nope-2");
}

#[tokio::test]
async fn annotations_round_trip_and_default_empty() {
    let app = setup().await;
    let tenant = Uuid::new_v4();
    seed_channels(&app, tenant).await;

    // A payload without annotations defaults to {} everywhere.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"plain","channels":["plain-hook"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["annotations"], serde_json::json!({}));

    // Create with annotations; the create response, single GET, and list all carry them.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"oncall","channels":["team-slack"],
                "annotations":{"team":"core","runbook":"https://rb"}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["annotations"]["team"], "core");
    assert_eq!(
        v["channels"][0], "team-slack",
        "receiver payloads carry channel names, no configs and no secrets"
    );

    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    let v = body_json(resp).await;
    assert_eq!(v["annotations"]["runbook"], "https://rb");
    assert_eq!(v["channels"][0], "team-slack");

    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers", tenant, ""))
        .await
        .unwrap();
    let list = body_json(resp).await;
    let oncall = list
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["name"] == "oncall")
        .unwrap();
    assert_eq!(oncall["annotations"]["team"], "core");

    // Upsert (same name) replaces the annotation map wholesale.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"oncall","channels":["team-slack"],
                "annotations":{"tier":"1"}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    let v = body_json(resp).await;
    assert_eq!(v["annotations"], serde_json::json!({"tier":"1"}));

    // Upsert without annotations resets to {} (full-replace semantics).
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"oncall","channels":["team-slack"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    let v = body_json(resp).await;
    assert_eq!(v["annotations"], serde_json::json!({}));

    // DELETE is unchanged.
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
