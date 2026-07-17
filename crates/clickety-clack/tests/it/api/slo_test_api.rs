//! `POST /v1/slos/:id/test`: a dry-run probe. It validates the posted spec,
//! then runs the SLI query against ClickHouse over the spec's own budget
//! window -- no DB write, no snapshot. The harness stubs `ch` at an
//! unreachable address, so a valid spec still surfaces 422 once it reaches
//! ClickHouse: that proves validation passed and the handler attempted the
//! query, without requiring a live ClickHouse (this repo runs no ClickHouse
//! testcontainer).

use crate::api::slos_api_support::{setup, TENANT};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn test_endpoint_validates_and_hits_ch() {
    let (router, _store) = setup().await;

    let body = json!({
        "name": "probe",
        "sli": {"sql": "SELECT 1 AS good,1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}"},
        "targetPercent": 99.9,
        "timeWindow": {"duration": "30d"}
    });
    let r = router
        .oneshot(
            Request::post("/v1/slos/00000000-0000-0000-0000-000000000000/test")
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    // Stub CH at 127.0.0.1:1 is unreachable -> 422 "query failed", proving the
    // handler validated the spec first and then reached ClickHouse.
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);
}
