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
    assert_eq!(v["code"], "conflict");
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
