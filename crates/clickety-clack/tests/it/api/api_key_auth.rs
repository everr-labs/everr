use crate::api::support::{body_json, state};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::api::auth::ApiKeySet;
use cc::api::{build_router, build_router_with_auth};
use tower::ServiceExt;
use uuid::Uuid;

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
        .oneshot(req("/v1/channels", tenant, None))
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
        .oneshot(req("/v1/channels", tenant, None))
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
        .oneshot(req("/v1/channels", tenant, Some("wrong-key")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Non-bearer scheme: 401.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/channels")
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
        .oneshot(req("/v1/channels", tenant, Some("key-current")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await, serde_json::json!([]));

    // Rotation: the second configured key also passes.
    let resp = app
        .clone()
        .oneshot(req("/v1/channels", tenant, Some("key-next")))
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
