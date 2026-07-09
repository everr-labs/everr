//! Cursor pagination on `GET /v1/rules`: envelope mode (limit/cursor), the
//! legacy bare-array mode, and cursor/limit rejection statuses.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::api::auth::HeaderAuth;
use cc::api::{build_router, AppState};
use cc::clickhouse::ChClient;
use cc::crypto::EnvKeyring;
use cc::domain::ids::{RuleId, TenantId};
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

async fn app_with_store() -> (axum::Router, PgStore) {
    let pg_url = crate::support::fresh_db().await;
    let store = PgStore::connect(&pg_url).await.unwrap();
    let state = AppState {
        store: store.clone(),
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
    (build_router(state), store)
}

async fn create_rule(app: &axum::Router, tenant: Uuid) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/v1/rules")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    body_json(resp).await["id"].as_str().unwrap().to_string()
}

async fn get_json(app: &axum::Router, tenant: Uuid, uri: &str) -> (StatusCode, serde_json::Value) {
    let req = Request::builder()
        .uri(uri)
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    (status, body_json(resp).await)
}

fn item_ids(page: &serde_json::Value) -> Vec<String> {
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn paginated_walk_covers_all_rules_and_matches_legacy_order() {
    let (app, _store) = app_with_store().await;
    let tenant = Uuid::new_v4();
    for _ in 0..5 {
        create_rule(&app, tenant).await;
    }

    // Legacy mode (no limit/cursor): bare array, all rules, unchanged shape.
    let (status, legacy) = get_json(&app, tenant, "/v1/rules").await;
    assert_eq!(status, StatusCode::OK);
    let legacy_ids: Vec<String> = legacy
        .as_array()
        .expect("legacy mode must stay a bare array")
        .iter()
        .map(|v| v["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(legacy_ids.len(), 5);

    // Paginated walk with limit=2: 2 + 2 + 1, then a null cursor.
    let mut walked: Vec<String> = Vec::new();
    let mut uri = "/v1/rules?limit=2".to_string();
    let mut pages = 0;
    loop {
        let (status, page) = get_json(&app, tenant, &uri).await;
        assert_eq!(status, StatusCode::OK);
        walked.extend(item_ids(&page));
        pages += 1;
        match page["next_cursor"].as_str() {
            Some(cursor) => uri = format!("/v1/rules?limit=2&cursor={cursor}"),
            None => break,
        }
        assert!(pages < 10, "cursor walk must terminate");
    }
    assert_eq!(pages, 3, "5 rules at limit=2 is 3 pages");
    assert_eq!(
        walked, legacy_ids,
        "pagination must yield the same rules in the same total order as the legacy listing"
    );

    // Items carry the full RuleView shape (health + rollup), same as legacy.
    let (_, first_page) = get_json(&app, tenant, "/v1/rules?limit=1").await;
    let item = &first_page["items"][0];
    assert_eq!(item["health"]["status"], "healthy");
    assert_eq!(item["rollup"]["alert_state"], "inactive");
}

#[tokio::test]
async fn page_boundary_at_data_end_yields_null_cursor() {
    let (app, _store) = app_with_store().await;
    let tenant = Uuid::new_v4();
    for _ in 0..3 {
        create_rule(&app, tenant).await;
    }
    // limit == row count: one full page, and no phantom next page.
    let (status, page) = get_json(&app, tenant, "/v1/rules?limit=3").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(item_ids(&page).len(), 3);
    assert!(page["next_cursor"].is_null());
}

#[tokio::test]
async fn paginated_mode_honors_health_filter() {
    let (app, store) = app_with_store().await;
    let tenant = Uuid::new_v4();
    let ids = [
        create_rule(&app, tenant).await,
        create_rule(&app, tenant).await,
    ];
    let tid = TenantId::from_trusted(tenant.to_string());
    store
        .record_rule_failure(
            RuleId(Uuid::parse_str(&ids[0]).unwrap()),
            &tid,
            "boom",
            1,
            OffsetDateTime::now_utc(),
        )
        .await
        .unwrap();

    let (status, page) = get_json(&app, tenant, "/v1/rules?health=degraded&limit=10").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(item_ids(&page), vec![ids[0].clone()]);
    assert!(page["next_cursor"].is_null());
}

#[tokio::test]
async fn bad_cursor_and_bad_limit_are_rejected() {
    let (app, _store) = app_with_store().await;
    let tenant = Uuid::new_v4();

    // Garbage cursor: 400 problem details.
    let (status, body) = get_json(&app, tenant, "/v1/rules?cursor=%21%21not-a-cursor").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "bad_request");
    assert_eq!(body["detail"], "invalid cursor");

    // Out-of-bounds / non-integer limit: 422 validation.
    for bad in ["0", "501", "abc"] {
        let (status, body) = get_json(&app, tenant, &format!("/v1/rules?limit={bad}")).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "limit={bad}");
        assert_eq!(body["code"], "validation_failed");
    }
}
