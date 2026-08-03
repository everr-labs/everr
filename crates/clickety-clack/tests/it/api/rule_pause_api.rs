use crate::api::support::{body_json, setup};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn pause_then_resume_round_trip() {
    let (app, _store) = setup().await;
    let tenant = Uuid::new_v4();

    // Create a rule.
    let create = Request::builder()
        .method("POST")
        .uri("/v1/rules")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"name":"t/pause_then_resume_round_trip","sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();

    // Pause -> 200, paused=true.
    let pause = Request::builder()
        .method("POST")
        .uri(format!("/v1/rules/{id}/pause"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(pause).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await["paused"], true);

    // Resume -> 200, paused=false.
    let resume = Request::builder()
        .method("POST")
        .uri(format!("/v1/rules/{id}/resume"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(resume).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await["paused"], false);

    // Pause an unknown id -> 404.
    let missing = Request::builder()
        .method("POST")
        .uri(format!("/v1/rules/{}/pause", Uuid::new_v4()))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(missing).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
