use crate::api::support::{body_json, req, setup};
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
async fn annotations_round_trip_and_default_empty() {
    let (app, _) = setup().await;
    let tenant = Uuid::new_v4();
    seed_channels(&app, tenant).await;

    // A payload without annotations defaults to {} everywhere.
    let resp = app
        .clone()
        .oneshot(req(
            "POST",
            "/v1/receivers",
            tenant,
            r#"{"name":"plain","channels":["plain-hook"]}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["annotations"], serde_json::json!({}));

    // Create with annotations; the create response, single GET, and list all carry them.
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
    let v = body_json(resp).await;
    assert_eq!(v["annotations"]["team"], "core");
    assert_eq!(
        v["channels"][0], "team-slack",
        "receiver payloads carry channel names, no configs and no secrets"
    );

    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    let v = body_json(resp).await;
    assert_eq!(v["annotations"]["runbook"], "https://rb");
    assert_eq!(v["channels"][0], "team-slack");

    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers", tenant, ""))
        .await
        .unwrap();
    let list = body_json(resp).await;
    let oncall = list
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["name"] == "oncall")
        .unwrap();
    assert_eq!(oncall["annotations"]["team"], "core");

    // Upsert (PUT by name) replaces the annotation map wholesale. POST is
    // create-only now, so the update flow goes through the PUT route.
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

    // Upsert without annotations resets to {} (full-replace semantics).
    let resp = app
        .clone()
        .oneshot(req(
            "PUT",
            "/v1/receivers/oncall",
            tenant,
            r#"{"channels":["team-slack"]}"#,
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
    assert_eq!(v["annotations"], serde_json::json!({}));

    // DELETE is unchanged.
    let resp = app
        .clone()
        .oneshot(req("DELETE", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = app
        .clone()
        .oneshot(req("GET", "/v1/receivers/oncall", tenant, ""))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
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
