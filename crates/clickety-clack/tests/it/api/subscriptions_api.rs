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

fn req(method: &str, uri: &str, tenant: Uuid, body: Option<&str>) -> Request<Body> {
    let b = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string());
    b.body(body.map_or(Body::empty(), |s| Body::from(s.to_string())))
        .unwrap()
}

#[tokio::test]
async fn subscriptions_create_list_delete_round_trip() {
    let app = setup().await;
    let tenant = Uuid::new_v4();

    // Empty list to start.
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/subscriptions", tenant, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await, serde_json::json!([]));

    // Create two subscriptions.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/subscriptions",
            tenant,
            Some(r#"{"webhook_url":"https://example.com/hook-a"}"#),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    let id_a = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["webhook_url"], "https://example.com/hook-a");
    assert!(
        created["created_at"].as_str().unwrap().contains('T'),
        "created_at must be an RFC 3339 string, got {}",
        created["created_at"]
    );
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/subscriptions",
            tenant,
            Some(r#"{"webhook_url":"https://example.com/hook-b"}"#),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // List returns both, decrypted, with id + webhook_url + created_at.
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/subscriptions", tenant, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let list = body_json(resp).await;
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    let urls: Vec<&str> = arr
        .iter()
        .map(|s| s["webhook_url"].as_str().unwrap())
        .collect();
    assert!(urls.contains(&"https://example.com/hook-a"));
    assert!(urls.contains(&"https://example.com/hook-b"));
    for s in arr {
        assert!(s["id"].as_str().is_some());
        assert!(s["created_at"].as_str().unwrap().contains('T'));
    }

    // Another tenant sees nothing and cannot delete ours.
    let other = Uuid::new_v4();
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/subscriptions", other, None))
        .await
        .unwrap();
    assert_eq!(body_json(resp).await, serde_json::json!([]));
    let resp = app
        .clone()
        .oneshot(req(
            "DELETE",
            &format!("/v1/subscriptions/{id_a}"),
            other,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Owner deletes: 200 + {"deleted": true}, then the list shrinks.
    let resp = app
        .clone()
        .oneshot(req(
            "DELETE",
            &format!("/v1/subscriptions/{id_a}"),
            tenant,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await, serde_json::json!({"deleted": true}));

    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/subscriptions", tenant, None))
        .await
        .unwrap();
    assert_eq!(body_json(resp).await.as_array().unwrap().len(), 1);

    // Deleting the same id again: 404.
    let resp = app
        .clone()
        .oneshot(req(
            "DELETE",
            &format!("/v1/subscriptions/{id_a}"),
            tenant,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
