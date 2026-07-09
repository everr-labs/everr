//! `suppressed` on the rule spec: accepted by POST /v1/rules and PUT /v1/rules/:id,
//! defaulted to false when omitted, and returned by every rule read.

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

#[tokio::test]
async fn suppressed_accepted_on_create_and_update_and_returned_on_reads() {
    let app = setup().await;
    let tenant = Uuid::new_v4();

    // POST with suppressed: true.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/rules",
            tenant,
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning","suppressed":true}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    assert_eq!(created["spec"]["suppressed"], true);
    let id = created["id"].as_str().unwrap().to_string();

    // GET returns it.
    let resp = app
        .clone()
        .oneshot(req("GET", &format!("/v1/rules/{id}"), tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await["spec"]["suppressed"], true);

    // PUT can flip it off (promote a preview to a live rule).
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/rules/{id}"),
            tenant,
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning","suppressed":false}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = body_json(resp).await;
    assert_eq!(updated["spec"]["suppressed"], false);
    assert_eq!(updated["version"], 2);

    // List reads return it too.
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/rules", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let list = body_json(resp).await;
    assert_eq!(list[0]["spec"]["suppressed"], false);
}

#[tokio::test]
async fn suppressed_defaults_false_when_omitted() {
    let app = setup().await;
    let tenant = Uuid::new_v4();
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/rules",
            tenant,
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await["spec"]["suppressed"], false);
}
