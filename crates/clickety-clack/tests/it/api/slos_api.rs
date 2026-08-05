use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

use crate::api::support::{body_json, setup, TENANT};

async fn create_slo(router: &axum::Router, name: &str) -> Value {
    let payload = json!({
        "name": name,
        "sli": { "sql": "SELECT countIf(ok) AS good, count() AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}" },
        "targetPercent": 99.9,
        "timeWindow": { "duration": "30d", "isRolling": true }
    });
    let resp = router
        .clone()
        .oneshot(
            Request::post("/v1/slos")
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    body_json(resp).await
}

#[tokio::test]
async fn create_rejects_missing_window_placeholder() {
    let (router, _store) = setup().await;
    let payload = json!({
        "name": "bad",
        "sli": { "sql": "SELECT 1 AS good, 1 AS valid FROM t" },
        "targetPercent": 99.9,
        "timeWindow": { "duration": "30d" }
    });
    let resp = router
        .oneshot(
            Request::post("/v1/slos")
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn duplicate_name_conflicts() {
    let (router, _store) = setup().await;
    create_slo(&router, "dup").await;
    let payload = json!({
        "name": "dup",
        "sli": { "sql": "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}" },
        "targetPercent": 99.9, "timeWindow": { "duration": "30d" }
    });
    let resp = router
        .oneshot(
            Request::post("/v1/slos")
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    // Name collisions carry `already_exists`, like channels/receivers.
    assert_eq!(body_json(resp).await["code"], "already_exists");
}

#[tokio::test]
async fn duplicate_namespace_style_name_conflicts() {
    // "default/checkout" exercises the shared `api::identity::validate_name`,
    // which (unlike the old SLO-local validator) allows the "project/slug"
    // convention consumers encode into names.
    let (router, _store) = setup().await;
    let created = create_slo(&router, "default/checkout").await;
    assert_eq!(created["name"], "default/checkout");

    let payload = json!({
        "name": "default/checkout",
        "sli": { "sql": "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}" },
        "targetPercent": 99.9, "timeWindow": { "duration": "30d" }
    });
    let resp = router
        .oneshot(
            Request::post("/v1/slos")
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn update_version_conflict_then_success() {
    let (router, _store) = setup().await;
    let created = create_slo(&router, "up").await;
    let id = created["id"].as_str().unwrap();

    let stale = json!({
        "sli": { "sql": "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}" },
        "targetPercent": 99.5, "timeWindow": { "duration": "30d" }, "version": 999
    });
    let resp = router
        .clone()
        .oneshot(
            Request::put(format!("/v1/slos/{id}"))
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(stale.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);

    let good = json!({
        "sli": { "sql": "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}" },
        "targetPercent": 99.5, "timeWindow": { "duration": "30d" }, "version": 1
    });
    let resp = router
        .oneshot(
            Request::put(format!("/v1/slos/{id}"))
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(good.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = body_json(resp).await;
    assert_eq!(updated["version"], 2);
    assert_eq!(updated["spec"]["targetPercent"], 99.5);
}

#[tokio::test]
async fn pause_resume_delete() {
    let (router, _store) = setup().await;
    let created = create_slo(&router, "pd").await;
    let id = created["id"].as_str().unwrap();

    let resp = router
        .clone()
        .oneshot(
            Request::post(format!("/v1/slos/{id}/pause"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let paused = body_json(resp).await;
    assert_eq!(paused["paused"], true);
    let resp = router
        .clone()
        .oneshot(
            Request::post(format!("/v1/slos/{id}/resume"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(body_json(resp).await["paused"], false);

    let resp = router
        .clone()
        .oneshot(
            Request::delete(format!("/v1/slos/{id}"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let resp = router
        .oneshot(
            Request::get(format!("/v1/slos/{id}"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn requires_tenant_header() {
    let (router, _store) = setup().await;
    let resp = router
        .oneshot(Request::get("/v1/slos").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
