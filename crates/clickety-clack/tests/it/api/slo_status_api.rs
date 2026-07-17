//! `GET /v1/slos/:id/status`: 404 before any snapshot exists, then a
//! read-only passthrough of the evaluator's `slo_status` row once seeded.

use crate::api::slos_api_support::{body_json, setup, TENANT};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn status_404_then_returns_snapshot() {
    let (router, store) = setup().await;

    // create via API to get an id
    let created = router
        .clone()
        .oneshot(
            Request::post("/v1/slos")
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "s",
                        "sli": {"sql": "SELECT 1 AS good,1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}"},
                        "targetPercent": 99.9,
                        "timeWindow": {"duration": "30d"}
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let id = body_json(created).await["id"].as_str().unwrap().to_string();

    // 404 before any snapshot
    let r = router
        .clone()
        .oneshot(
            Request::get(format!("/v1/slos/{id}/status"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);

    // seed a snapshot directly, then GET
    use cc::domain::ids::{SloId, TenantId};
    store
        .upsert_slo_status(
            SloId(id.parse().unwrap()),
            &TenantId::from_trusted(TENANT),
            &json!({"groups":[],"window":"30d","target_percent":99.9,"degraded":false,"window_computed_at":{}}),
            time::OffsetDateTime::now_utc(),
        )
        .await
        .unwrap();
    let r = router
        .oneshot(
            Request::get(format!("/v1/slos/{id}/status"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let b = body_json(r).await;
    assert_eq!(b["payload"]["window"], "30d");
    assert!(b["computed_at"].as_str().is_some());
}
