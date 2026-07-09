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

async fn setup() -> axum::Router {
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
async fn create_accepts_and_returns_repeat_interval() {
    let app = setup().await;
    let tenant = Uuid::new_v4();

    // Without the field: repeats stay off (null in the response).
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[],"receiver":"ops"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["repeat_interval_secs"], serde_json::Value::Null);

    // With the field at the minimum: stored and echoed.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[],"receiver":"ops","repeat_interval_secs":60}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["repeat_interval_secs"], 60);

    // The list echoes it back too.
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/routes", tenant, ""))
        .await
        .unwrap();
    let list = body_json(resp).await;
    let repeats: Vec<_> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["repeat_interval_secs"].clone())
        .collect();
    assert!(repeats.contains(&serde_json::json!(60)));
    assert!(repeats.contains(&serde_json::Value::Null));
}

#[tokio::test]
async fn repeat_interval_below_minimum_is_422_on_create_and_update() {
    let app = setup().await;
    let tenant = Uuid::new_v4();

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[],"receiver":"ops","repeat_interval_secs":59}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let v = body_json(resp).await;
    assert_eq!(v["code"], "validation_failed");
    assert_eq!(v["status"], 422);
    assert!(
        v["detail"]
            .as_str()
            .unwrap()
            .contains("repeat_interval_secs"),
        "detail names the field: {v}"
    );

    // Same validation on PUT.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[],"receiver":"ops"}"#,
        ))
        .await
        .unwrap();
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/routes/{id}"),
            tenant,
            r#"{"matchers":[],"receiver":"ops","repeat_interval_secs":1}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // Empty receiver is rejected on PUT exactly like create.
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/routes/{id}"),
            tenant,
            r#"{"matchers":[],"receiver":"  "}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn put_replaces_the_route_in_full() {
    let app = setup().await;
    let tenant = Uuid::new_v4();

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[{"label":"severity","op":"eq","value":"critical"}],
                "receiver":"ops","continue":true,"priority":3,
                "group_wait_secs":5,"group_interval_secs":60,"repeat_interval_secs":300}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap().to_string();

    // Full replace: new receiver/priority, matchers cleared, repeat dropped back to null.
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/routes/{id}"),
            tenant,
            r#"{"matchers":[],"receiver":"pd","priority":7,"group_by":["cluster"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["id"], id.as_str(), "id preserved");
    assert_eq!(v["receiver"], "pd");
    assert_eq!(v["priority"], 7);
    assert_eq!(v["continue"], false, "absent fields reset to defaults");
    assert_eq!(v["matchers"], serde_json::json!([]));
    assert_eq!(v["group_by"], serde_json::json!(["cluster"]));
    assert_eq!(v["group_wait_secs"], serde_json::Value::Null);
    assert_eq!(v["repeat_interval_secs"], serde_json::Value::Null);

    // The stored route reflects the replacement.
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/routes", tenant, ""))
        .await
        .unwrap();
    let list = body_json(resp).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["receiver"], "pd");
    assert_eq!(list[0]["repeat_interval_secs"], serde_json::Value::Null);
}

#[tokio::test]
async fn put_unknown_or_foreign_route_is_404() {
    let app = setup().await;
    let tenant = Uuid::new_v4();
    let body = r#"{"matchers":[],"receiver":"ops"}"#;

    // Unknown id.
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/routes/{}", Uuid::new_v4()),
            tenant,
            body,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let v = body_json(resp).await;
    assert_eq!(v["code"], "not_found");

    // Another tenant's route.
    let resp = app
        .clone()
        .oneshot(req("POST", "/v1/routes", tenant, body))
        .await
        .unwrap();
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/routes/{id}"),
            Uuid::new_v4(),
            body,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
