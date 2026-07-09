use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::api::auth::{ApiKeySet, HeaderAuth};
use cc::api::{build_router, build_router_with_auth, AppState};
use cc::clickhouse::ChClient;
use cc::crypto::EnvKeyring;
use cc::stores::PgStore;
use std::collections::HashMap;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

async fn state() -> AppState {
    let pg_url = crate::support::fresh_db().await;
    let store = PgStore::connect(&pg_url).await.unwrap();
    AppState {
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
    }
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// GET request with a tenant header and an optional `Authorization: Bearer`.
fn req(uri: &str, tenant: Uuid, bearer: Option<&str>) -> Request<Body> {
    let mut b = Request::builder()
        .method("GET")
        .uri(uri)
        .header("X-CC-Tenant", tenant.to_string());
    if let Some(key) = bearer {
        b = b.header("authorization", format!("Bearer {key}"));
    }
    b.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn no_keys_configured_leaves_the_api_open() {
    // `build_router` carries no keys: requests pass with no Authorization header.
    let app = build_router(state().await);
    let tenant = Uuid::new_v4();

    let resp = app
        .clone()
        .oneshot(req("/v1/subscriptions", tenant, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await, serde_json::json!([]));
}

#[tokio::test]
async fn configured_keys_gate_v1() {
    let keys = ApiKeySet::from_env_value(Some("key-current,key-next"));
    let app = build_router_with_auth(state().await, keys);
    let tenant = Uuid::new_v4();

    // Missing Authorization header: 401 problem-details.
    let resp = app
        .clone()
        .oneshot(req("/v1/subscriptions", tenant, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = body_json(resp).await;
    assert_eq!(body["status"], 401);
    assert_eq!(body["code"], "unauthorized");
    assert_eq!(body["detail"], "missing or invalid API key");

    // Wrong key: 401.
    let resp = app
        .clone()
        .oneshot(req("/v1/subscriptions", tenant, Some("wrong-key")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Non-bearer scheme: 401.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/subscriptions")
                .header("X-CC-Tenant", tenant.to_string())
                .header("authorization", "Basic a2V5LWN1cnJlbnQ=")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Correct key: through to the handler.
    let resp = app
        .clone()
        .oneshot(req("/v1/subscriptions", tenant, Some("key-current")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await, serde_json::json!([]));

    // Rotation: the second configured key also passes.
    let resp = app
        .clone()
        .oneshot(req("/v1/subscriptions", tenant, Some("key-next")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Health endpoints never require a key.
    for path in ["/healthz", "/readyz"] {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "{path} must stay open");
    }
}
