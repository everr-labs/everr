use crate::api::support::{body_json, req, seed_receivers, setup};
use axum::http::StatusCode;
use tower::ServiceExt;
use uuid::Uuid;

/// Create the named channels the receiver tests reference.
async fn seed_channels(app: &axum::Router, tenant: Uuid) {
    for body in [
        r#"{"name":"plain-hook","config":{"type":"webhook","url":"http://x/h"}}"#,
        r#"{"name":"team-slack","config":{"type":"slack","url":"https://hooks.slack/SECRET"}}"#,
    ] {
        let resp = app
            .clone()
            .oneshot(req("POST", "/v1/channels", tenant, body))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}

#[tokio::test]
async fn channels_crud_redaction_and_referenced_delete_conflict() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();

    // Create; the response redacts the secret but keeps the type.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/channels",
            tenant,
            r#"{"name":"team-slack","config":{"type":"slack","url":"https://hooks.slack/SECRET"}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["name"], "team-slack");
    assert_eq!(v["config"]["type"], "slack");
    assert_eq!(v["config"]["url"], "***", "secret redacted on create");

    // GET and list redact too.
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/channels/team-slack", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["config"]["url"], "***");
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/channels", tenant, ""))
        .await
        .unwrap();
    let list = body_json(resp).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["config"]["url"], "***");

    // Deleting while a receiver references it is a 409 naming the referrer.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"oncall","channels":["team-slack"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/channels/team-slack", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let v = body_json(resp).await;
    assert_eq!(v["detail"], "channel is referenced by receivers: oncall");

    // Drop the receiver; the delete goes through, then 404s.
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/channels/team-slack", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/channels/team-slack", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn generic_webhook_url_is_redacted_on_every_read_path() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    let secret = "https://example.com/hooks/SECRET-TOKEN";

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/channels",
            tenant,
            &format!(r#"{{"name":"generic-hook","config":{{"type":"webhook","url":"{secret}"}}}}"#),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    assert_eq!(created["config"]["url"], "***");
    assert!(!created.to_string().contains("SECRET-TOKEN"));

    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/channels/generic-hook", tenant, ""))
        .await
        .unwrap();
    let fetched = body_json(resp).await;
    assert_eq!(fetched["config"]["url"], "***");
    assert!(!fetched.to_string().contains("SECRET-TOKEN"));

    let resp = app
        .oneshot(req("GET", "/v1/channels", tenant, ""))
        .await
        .unwrap();
    let listed = body_json(resp).await;
    assert_eq!(listed[0]["config"]["url"], "***");
    assert!(!listed.to_string().contains("SECRET-TOKEN"));
}

#[tokio::test]
async fn receiver_with_unknown_channels_is_rejected_naming_them() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    seed_channels(&app, tenant).await;

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"oncall","channels":["team-slack","nope-1","nope-2"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let v = body_json(resp).await;
    assert_eq!(v["detail"], "unknown channels: nope-1, nope-2");
}

#[tokio::test]
async fn put_replaces_annotations() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    seed_channels(&app, tenant).await;

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"oncall","channels":["team-slack"],
                "annotations":{"team":"core","runbook":"https://rb"}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            "/v1/receivers/oncall",
            tenant,
            r#"{"channels":["team-slack"],"annotations":{"tier":"1"}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    let v = body_json(resp).await;
    assert_eq!(v["annotations"], serde_json::json!({"tier":"1"}));
}

/// POST is create-only: re-posting an existing channel name must 409 with the
/// `already_exists` code and leave the stored (secret-bearing) config intact;
/// PUT is the explicit replace/rotation path. Same contract for receivers.
#[tokio::test]
async fn channel_create_is_create_only_and_put_replaces() {
    // Built from the raw state (not `setup`) so the test can decrypt stored
    // configs with the same cipher the API used.
    let state = crate::api::support::state().await;
    let store = state.store.clone();
    let cipher = state.cipher.clone();
    let app = cc::api::build_router(state);
    let tenant = Uuid::new_v4();

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/channels",
            tenant,
            r#"{"name":"hook","config":{"type":"webhook","url":"http://x/original"}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Same name again: 409 already_exists, stored config untouched.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/channels",
            tenant,
            r#"{"name":"hook","config":{"type":"webhook","url":"http://x/clobber"}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let v = body_json(resp).await;
    assert_eq!(v["code"], "already_exists");
    let stored = store
        .get_channel(
            &*cipher,
            cc::domain::ids::TenantId::from_trusted(tenant.to_string()),
            "hook",
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        stored.config,
        cc::domain::channel::ChannelConfig::Webhook {
            url: "http://x/original".into()
        },
        "a rejected create must not overwrite the stored config"
    );

    // PUT by name replaces the config (the rotation path) and creates on a miss.
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            "/v1/channels/hook",
            tenant,
            r#"{"config":{"type":"webhook","url":"http://x/rotated"}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let stored = store
        .get_channel(
            &*cipher,
            cc::domain::ids::TenantId::from_trusted(tenant.to_string()),
            "hook",
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        stored.config,
        cc::domain::channel::ChannelConfig::Webhook {
            url: "http://x/rotated".into()
        }
    );
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            "/v1/channels/fresh",
            tenant,
            r#"{"config":{"type":"email","to":["oncall@x.test"]}}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "PUT creates on a miss");
}

#[tokio::test]
async fn receiver_create_is_create_only_and_put_replaces() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    seed_channels(&app, tenant).await;

    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"oncall","channels":["team-slack"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Same name again: 409 already_exists, stored channel list untouched.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"oncall","channels":["plain-hook"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let v = body_json(resp).await;
    assert_eq!(v["code"], "already_exists");
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    let v = body_json(resp).await;
    assert_eq!(v["channels"], serde_json::json!(["team-slack"]));

    // PUT by name replaces the channel list; unknown channels still 422.
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            "/v1/receivers/oncall",
            tenant,
            r#"{"channels":["plain-hook"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    let v = body_json(resp).await;
    assert_eq!(v["channels"], serde_json::json!(["plain-hook"]));
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            "/v1/receivers/oncall",
            tenant,
            r#"{"channels":["nope"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let v = body_json(resp).await;
    assert_eq!(v["detail"], "unknown channels: nope");
}

#[tokio::test]
async fn receiver_delete_is_409_while_a_route_targets_it() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    seed_receivers(&app, tenant, &["ops"]).await;

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
        .oneshot(req("DELETE", "/v1/receivers/ops", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let v = body_json(resp).await;
    assert_eq!(v["code"], "conflict");
    assert_eq!(
        v["detail"],
        format!("receiver is referenced by routes: {id}"),
        "the 409 names the routes that would be stranded"
    );

    // Drop the route and the receiver becomes deletable.
    let resp = app
        .clone()
        .oneshot(req("DELETE", &format!("/v1/routes/{id}"), tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/receivers/ops", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}
