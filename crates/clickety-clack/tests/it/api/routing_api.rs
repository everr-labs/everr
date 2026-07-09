use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::api::auth::HeaderAuth;
use cc::api::{build_router, AppState};
use cc::clickhouse::ChClient;
use cc::crypto::EnvKeyring;
use cc::stores::PgStore;
use std::collections::HashMap;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn receiver_create_then_get_redacts_secret() {
    let pg_url = crate::support::fresh_db().await;
    let store = PgStore::connect(&pg_url).await.unwrap();

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
        allow_private_webhooks: false,
    };
    let app = build_router(state);
    let tenant = Uuid::new_v4();

    let create_channel = Request::builder()
        .method("POST")
        .uri("/v1/channels")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"name":"team-slack","config":{"type":"slack","url":"https://hooks.slack.test/SECRET"}}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(create_channel).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    assert_eq!(
        created["config"]["url"], "***",
        "channel create response is redacted"
    );

    let create = Request::builder()
        .method("POST")
        .uri("/v1/receivers")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(r#"{"name":"oncall","channels":["team-slack"]}"#))
        .unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    assert_eq!(
        created["channels"][0], "team-slack",
        "receiver responses carry channel names only"
    );

    let get = Request::builder()
        .method("GET")
        .uri("/v1/receivers/oncall")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(get).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let got = body_json(resp).await;
    assert_eq!(got["name"], "oncall");
    assert_eq!(got["channels"], serde_json::json!(["team-slack"]));

    let get_channel = Request::builder()
        .method("GET")
        .uri("/v1/channels/team-slack")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(get_channel).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let got = body_json(resp).await;
    assert_eq!(got["config"]["type"], "slack");
    assert_eq!(got["config"]["url"], "***");
}
