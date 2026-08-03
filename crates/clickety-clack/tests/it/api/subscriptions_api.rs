use crate::api::support::{body_json, setup};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
use uuid::Uuid;

fn req(method: &str, uri: &str, tenant: Uuid, body: Option<&str>) -> Request<Body> {
    let b = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string());
    b.body(body.map_or(Body::empty(), |s| Body::from(s.to_string())))
        .unwrap()
}

#[tokio::test]
async fn subscriptions_create_list_delete_round_trip() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/subscriptions",
            tenant,
            Some(r#"{"webhook_url":"https://example.com/hook-a"}"#),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    let id_a = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["webhook_url"], "***");

    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/subscriptions", tenant, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let list = body_json(resp).await;
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["webhook_url"], "***");

    let other = Uuid::new_v4();
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/subscriptions", other, None))
        .await
        .unwrap();
    assert_eq!(body_json(resp).await, serde_json::json!([]));
    let resp = app
        .clone()
        .oneshot(req(
            "DELETE",
            &format!("/v1/subscriptions/{id_a}"),
            other,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let resp = app
        .clone()
        .oneshot(req(
            "DELETE",
            &format!("/v1/subscriptions/{id_a}"),
            tenant,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}
