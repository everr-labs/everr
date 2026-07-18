//! `suppressed` on the rule spec: accepted by POST /v1/rules and PUT /v1/rules/:id,
//! defaulted to false when omitted, and returned by every rule read.

use crate::api::support::{body_json, req, setup};
use axum::http::StatusCode;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn suppressed_accepted_on_create_and_update_and_returned_on_reads() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();

    // POST with suppressed: true.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/rules",
            tenant,
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning","suppressed":true}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    assert_eq!(created["spec"]["suppressed"], true);
    let id = created["id"].as_str().unwrap().to_string();

    // GET returns it.
    let resp = app
        .clone()
        .oneshot(req("GET", &format!("/v1/rules/{id}"), tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await["spec"]["suppressed"], true);

    // PUT can flip it off (promote a preview to a live rule).
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/rules/{id}"),
            tenant,
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning","suppressed":false}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = body_json(resp).await;
    assert_eq!(updated["spec"]["suppressed"], false);
    assert_eq!(updated["version"], 2);

    // List reads return it too.
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/rules", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let list = body_json(resp).await;
    assert_eq!(list["items"][0]["spec"]["suppressed"], false);
}

#[tokio::test]
async fn suppressed_defaults_false_when_omitted() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/rules",
            tenant,
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await["spec"]["suppressed"], false);
}
