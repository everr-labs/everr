use crate::api::support::{body_json, setup};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::domain::ids::{RuleId, TenantId};
use time::OffsetDateTime;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn get_and_list_expose_rule_health() {
    let (app, store2) = setup().await;
    let tenant = Uuid::new_v4();

    // Create a rule.
    let create = Request::builder()
        .method("POST")
        .uri("/v1/rules")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"name":"t/get_and_list_expose_rule_health","sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();

    let get = Request::builder()
        .uri(format!("/v1/rules/{id}"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(get).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["health"]["status"], "healthy");
    assert_eq!(body["health"]["consecutive_failures"], 0);

    let tid = TenantId::from_trusted(tenant.to_string());
    let rid = RuleId(Uuid::parse_str(&id).unwrap());
    store2
        .record_rule_failure(rid, &tid, "boom", 1, OffsetDateTime::now_utc(), None)
        .await
        .unwrap();

    let get = Request::builder()
        .uri(format!("/v1/rules/{id}"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let body = body_json(app.clone().oneshot(get).await.unwrap()).await;
    assert_eq!(body["health"]["status"], "degraded");
    assert_eq!(body["health"]["consecutive_failures"], 1);
    assert_eq!(body["health"]["last_error"], "boom");

    let list_degraded = Request::builder()
        .uri("/v1/rules?health=degraded")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let body = body_json(app.clone().oneshot(list_degraded).await.unwrap()).await;
    assert_eq!(body["items"].as_array().unwrap().len(), 1);

    let list_healthy = Request::builder()
        .uri("/v1/rules?health=healthy")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let body = body_json(app.clone().oneshot(list_healthy).await.unwrap()).await;
    assert_eq!(body["items"].as_array().unwrap().len(), 0);

    let bad = Request::builder()
        .uri("/v1/rules?health=bogus")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(bad).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}
