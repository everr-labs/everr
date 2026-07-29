use crate::api::support::{body_json, req, seed_receivers, setup};
use axum::http::StatusCode;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn repeat_interval_below_minimum_is_422_on_create_and_update() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    seed_receivers(&app, tenant, &["ops"]).await;

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[],"receiver":"ops","repeat_interval_secs":59}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let v = body_json(resp).await;
    assert_eq!(v["code"], "validation_failed");
    assert_eq!(v["status"], 422);
    assert!(
        v["detail"]
            .as_str()
            .unwrap()
            .contains("repeat_interval_secs"),
        "detail names the field: {v}"
    );

    // Same validation on PUT.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[],"receiver":"ops"}"#,
        ))
        .await
        .unwrap();
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/routes/{id}"),
            tenant,
            r#"{"matchers":[],"receiver":"ops","repeat_interval_secs":1}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // Empty receiver is rejected on PUT exactly like create.
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/routes/{id}"),
            tenant,
            r#"{"matchers":[],"receiver":"  "}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn put_replaces_the_route_in_full() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    seed_receivers(&app, tenant, &["ops", "pd"]).await;

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[{"label":"severity","op":"eq","value":"critical"}],
                "receiver":"ops","continue":true,"priority":3,
                "group_wait_secs":5,"group_interval_secs":60,"repeat_interval_secs":300}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap().to_string();

    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/routes/{id}"),
            tenant,
            r#"{"matchers":[],"receiver":"pd","priority":7,"group_by":["cluster"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["receiver"], "pd");
    assert_eq!(v["priority"], 7);
    assert_eq!(v["group_by"], serde_json::json!(["cluster"]));
    assert_eq!(v["repeat_interval_secs"], serde_json::Value::Null);

    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/routes", tenant, ""))
        .await
        .unwrap();
    let list = body_json(resp).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["receiver"], "pd");
}

#[tokio::test]
async fn put_unknown_or_foreign_route_is_404() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    seed_receivers(&app, tenant, &["ops"]).await;
    let body = r#"{"matchers":[],"receiver":"ops"}"#;

    // Unknown id.
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/routes/{}", Uuid::new_v4()),
            tenant,
            body,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let v = body_json(resp).await;
    assert_eq!(v["code"], "not_found");

    // Another tenant's route.
    let other = Uuid::new_v4();
    let resp = app
        .clone()
        .oneshot(req("POST", "/v1/routes", tenant, body))
        .await
        .unwrap();
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();
    let resp = app
        .clone()
        .oneshot(req("PUT", &format!("/v1/routes/{id}"), other, body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn route_naming_an_unknown_receiver_is_422_on_create_and_update() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    seed_receivers(&app, tenant, &["ops"]).await;

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[],"receiver":"gone"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let v = body_json(resp).await;
    assert_eq!(v["code"], "validation_failed");
    assert_eq!(v["detail"], "unknown receiver: gone");

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[],"receiver":"ops"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            &format!("/v1/routes/{id}"),
            tenant,
            r#"{"matchers":[],"receiver":"gone"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body_json(resp).await["detail"], "unknown receiver: gone");

    // Receivers are tenant-scoped.
    let other = Uuid::new_v4();
    seed_receivers(&app, other, &["private"]).await;
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/routes",
            tenant,
            r#"{"matchers":[],"receiver":"private"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body_json(resp).await["detail"], "unknown receiver: private");
}
