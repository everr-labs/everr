use crate::api::support::{body_json, req, setup};
use axum::http::StatusCode;
use tower::ServiceExt;
use uuid::Uuid;

fn spec_body(name: &str) -> String {
    format!(
        r#"{{"name":"{name}","sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}}"#
    )
}

#[tokio::test]
async fn create_name_conflict_is_409() {
    let (app, _store) = setup().await;
    let tenant = Uuid::new_v4();

    let first = req("POST", "/v1/rules", tenant, &spec_body("default/dup"));
    let resp = app.clone().oneshot(first).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let second = req("POST", "/v1/rules", tenant, &spec_body("default/dup"));
    let resp = app.clone().oneshot(second).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let v = body_json(resp).await;
    // Name collisions carry `already_exists` (same code as channels/receivers);
    // `conflict` stays reserved for version mismatches and in-use deletes.
    assert_eq!(v["code"], "already_exists");
    assert_eq!(v["status"], 409);
}

#[tokio::test]
async fn create_bad_name_is_422() {
    let (app, _store) = setup().await;
    let tenant = Uuid::new_v4();

    let bad = req("POST", "/v1/rules", tenant, &spec_body("bad name"));
    let resp = app.clone().oneshot(bad).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let v = body_json(resp).await;
    assert_eq!(v["code"], "validation_failed");
}

/// `POST /v1/rules/test`: a dry-run probe with no `:id` (nothing needs to
/// exist). The harness stubs ClickHouse at an unreachable address, so a valid
/// spec surfaces 422 "query failed": proof the handler validated the spec and
/// then attempted the query.
#[tokio::test]
async fn test_endpoint_validates_and_hits_ch() {
    let (app, _store) = setup().await;
    let tenant = Uuid::new_v4();

    let body = r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#;
    let resp = app
        .oneshot(req("POST", "/v1/rules/test", tenant, body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let v = body_json(resp).await;
    assert!(
        v["detail"].as_str().unwrap_or("").contains("query failed"),
        "expected the probe to reach ClickHouse, got: {v}"
    );
}
