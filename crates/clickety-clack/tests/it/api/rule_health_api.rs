use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::api::auth::HeaderAuth;
use cc::api::{build_router, AppState};
use cc::clickhouse::ChClient;
use cc::crypto::EnvKeyring;
use cc::domain::ids::{RuleId, TenantId};
use cc::domain::Event;
use cc::stores::PgStore;
use std::collections::HashMap;
use std::sync::Arc;
use time::OffsetDateTime;
use tower::ServiceExt;
use uuid::Uuid;

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn get_and_list_expose_rule_health() {
    let pg_url = crate::support::fresh_db().await;
    let store = PgStore::connect(&pg_url).await.unwrap();
    let store2 = store.clone(); // used to degrade the rule directly
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
    let app = build_router(state);
    let tenant = Uuid::new_v4();

    // Create a rule.
    let create = Request::builder()
        .method("POST")
        .uri("/v1/rules")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();

    // Healthy initially.
    let get = Request::builder()
        .uri(format!("/v1/rules/{id}"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(get).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["health"]["status"], "healthy");
    assert_eq!(body["health"]["consecutive_failures"], 0);

    // Degrade it directly (threshold 1).
    let tid = TenantId::from_trusted(tenant.to_string());
    let rid = RuleId(Uuid::parse_str(&id).unwrap());
    store2
        .record_rule_failure(rid, &tid, "boom", 1, OffsetDateTime::now_utc())
        .await
        .unwrap();

    // GET reflects degraded health.
    let get = Request::builder()
        .uri(format!("/v1/rules/{id}"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let body = body_json(app.clone().oneshot(get).await.unwrap()).await;
    assert_eq!(body["health"]["status"], "degraded");
    assert_eq!(body["health"]["consecutive_failures"], 1);
    assert_eq!(body["health"]["last_error"], "boom");

    // List filter: ?health=degraded returns the rule; ?health=healthy does not.
    let list_degraded = Request::builder()
        .uri("/v1/rules?health=degraded")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let body = body_json(app.clone().oneshot(list_degraded).await.unwrap()).await;
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["health"]["status"], "degraded");

    let list_healthy = Request::builder()
        .uri("/v1/rules?health=healthy")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let body = body_json(app.clone().oneshot(list_healthy).await.unwrap()).await;
    assert_eq!(body.as_array().unwrap().len(), 0);

    // Invalid filter -> 422 (the API's validation-failure status).
    let bad = Request::builder()
        .uri("/v1/rules?health=bogus")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(bad).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}
