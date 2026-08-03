use crate::api::support::{body_json, setup};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn silence_create_list_delete() {
    let (app, _store) = setup().await;
    let tenant = Uuid::new_v4();

    let create = Request::builder()
        .method("POST")
        .uri("/v1/silences")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"matchers":[{"label":"svc","op":"eq","value":"api"}],"starts_at":"2026-06-14T00:00:00Z","ends_at":"2026-06-14T01:00:00Z","comment":"maint","author":"ops"}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["comment"], "maint");

    let list = Request::builder()
        .method("GET")
        .uri("/v1/silences")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(list).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let arr = body_json(resp).await;
    assert_eq!(arr.as_array().unwrap().len(), 1);

    let del = Request::builder()
        .method("DELETE")
        .uri(format!("/v1/silences/{id}"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(del).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let del2 = Request::builder()
        .method("DELETE")
        .uri(format!("/v1/silences/{id}"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(del2).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

/// An empty matcher list matches every alert (`matchers_match(&[], _)` is true), so
/// accepting one would let a single request mute the entire tenant for the window.
#[tokio::test]
async fn silence_create_rejects_an_empty_matcher_list() {
    let (app, _store) = setup().await;
    let tenant = Uuid::new_v4();

    let create = Request::builder()
        .method("POST")
        .uri("/v1/silences")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"matchers":[],"starts_at":"2026-06-14T00:00:00Z","ends_at":"2026-06-14T01:00:00Z"}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // Nothing was stored.
    let list = Request::builder()
        .method("GET")
        .uri("/v1/silences")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(list).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(body_json(resp).await.as_array().unwrap().is_empty());
}
