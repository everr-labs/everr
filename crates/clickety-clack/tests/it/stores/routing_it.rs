use crate::common::test_cipher;
use cc::domain::channel::ChannelConfig;
use cc::domain::ids::TenantId;
use cc::domain::routing::{MatchOp, Matcher};
use cc::stores::{ChannelDelete, PgStore, ReceiverDelete, ReceiverWrite, RouteCreate, RouteUpdate};
use std::collections::BTreeMap;
use uuid::Uuid;

#[tokio::test]
async fn receivers_upsert_and_routes_order() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    let cipher = test_cipher();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "hook-a",
            &ChannelConfig::Webhook {
                url: "http://a".into(),
            },
        )
        .await
        .unwrap();
    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "hook-b",
            &ChannelConfig::Webhook {
                url: "http://b".into(),
            },
        )
        .await
        .unwrap();

    let ReceiverWrite::Stored(r1) = store
        .create_receiver(
            tenant.clone(),
            "ops",
            &["hook-a".to_string()],
            &BTreeMap::from([("team".to_string(), "core".to_string())]),
        )
        .await
        .unwrap()
    else {
        panic!("expected the receiver to be stored");
    };
    let ReceiverWrite::Stored(r2) = store
        .create_receiver(
            tenant.clone(),
            "ops",
            &["hook-b".to_string()],
            &BTreeMap::from([("oncall".to_string(), "https://rota".to_string())]),
        )
        .await
        .unwrap()
    else {
        panic!("expected the receiver to be stored");
    };
    assert_eq!(r1.id, r2.id, "upsert keeps the same id");
    assert_eq!(
        r1.annotations.get("team").map(String::as_str),
        Some("core"),
        "create returns the stored annotations"
    );
    assert_eq!(store.list_receivers(tenant.clone()).await.unwrap().len(), 1);
    let got = store
        .get_receiver(tenant.clone(), "ops")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(got.channels, vec!["hook-b".to_string()]);
    assert_eq!(
        got.annotations,
        BTreeMap::from([("oncall".to_string(), "https://rota".to_string())]),
        "upsert replaces annotations wholesale"
    );

    // A route may only target a receiver that exists, so seed the second one.
    store
        .create_receiver(
            tenant.clone(),
            "pd",
            &["hook-b".to_string()],
            &BTreeMap::new(),
        )
        .await
        .unwrap();
    store
        .create_route(
            tenant.clone(),
            &[matcher("severity", "warning")],
            "ops",
            true,
            10,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
    store
        .create_route(
            tenant.clone(),
            &[matcher("severity", "critical")],
            "pd",
            false,
            1,
            None,
            None,
            None,
            Some(600),
        )
        .await
        .unwrap();
    let routes = store.routes_for(tenant.clone()).await.unwrap();
    assert_eq!(routes.len(), 2);
    assert_eq!(routes[0].receiver, "pd"); // priority 1 first
    assert_eq!(routes[0].repeat_interval_secs, Some(600));
    assert_eq!(routes[1].receiver, "ops");
    assert_eq!(routes[1].repeat_interval_secs, None);

    assert!(store
        .delete_route(tenant.clone(), routes[0].id)
        .await
        .unwrap());
    assert_eq!(store.routes_for(tenant.clone()).await.unwrap().len(), 1);
    // "pd" is now unreferenced and deletable; "ops" still has its route, so deleting it
    // would strand that route and is refused with the referring route id.
    assert_eq!(
        store.delete_receiver(tenant.clone(), "pd").await.unwrap(),
        ReceiverDelete::Deleted
    );
    assert_eq!(
        store.delete_receiver(tenant.clone(), "ops").await.unwrap(),
        ReceiverDelete::InUse(vec![routes[1].id])
    );
    assert!(store
        .delete_route(tenant.clone(), routes[1].id)
        .await
        .unwrap());
    assert_eq!(
        store.delete_receiver(tenant.clone(), "ops").await.unwrap(),
        ReceiverDelete::Deleted
    );
    assert_eq!(
        store.delete_receiver(tenant.clone(), "ops").await.unwrap(),
        ReceiverDelete::NotFound
    );
    assert!(store.list_receivers(tenant).await.unwrap().is_empty());
}

/// The routes -> receivers foreign key is what rejects a route naming a receiver that
/// does not exist, on both write paths, and it is equally what rejects one whose
/// receiver a concurrent delete removed mid-write. Writing against a name that was never
/// created is the deterministic proxy for that race.
#[tokio::test]
async fn route_write_rejects_unknown_receiver() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    let cipher = test_cipher();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "hook",
            &ChannelConfig::Webhook {
                url: "http://a".into(),
            },
        )
        .await
        .unwrap();
    store
        .create_receiver(
            tenant.clone(),
            "ops",
            &["hook".to_string()],
            &BTreeMap::new(),
        )
        .await
        .unwrap();

    // Create path: rejected, and no route row is written.
    let outcome = store
        .create_route(
            tenant.clone(),
            &[],
            "gone",
            false,
            0,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(outcome, RouteCreate::MissingReceiver);
    assert!(
        store.routes_for(tenant.clone()).await.unwrap().is_empty(),
        "a rejected route write must not persist a row"
    );

    // Update path: an existing route cannot be repointed at a missing receiver, and the
    // stored row keeps its original receiver.
    let RouteCreate::Created(route) = store
        .create_route(tenant.clone(), &[], "ops", false, 0, None, None, None, None)
        .await
        .unwrap()
    else {
        panic!("expected the route to be created");
    };
    let outcome = store
        .update_route(
            tenant.clone(),
            route.id,
            &[],
            "gone",
            false,
            0,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(outcome, RouteUpdate::MissingReceiver);
    let routes = store.routes_for(tenant.clone()).await.unwrap();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0].receiver, "ops");

    // A receiver that exists but a route id that does not is still a 404-shaped miss.
    let outcome = store
        .update_route(
            tenant.clone(),
            Uuid::new_v4(),
            &[],
            "ops",
            false,
            0,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(outcome, RouteUpdate::NotFound);
}

#[tokio::test]
async fn channels_upsert_resolve_and_referenced_delete_guard() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    let cipher = test_cipher();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    let c1 = store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "team-slack",
            &ChannelConfig::Slack {
                url: "https://hooks.slack/ONE".into(),
            },
        )
        .await
        .unwrap();
    // Upsert by name replaces the config (secret rotation) and keeps the id.
    let c2 = store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "team-slack",
            &ChannelConfig::Slack {
                url: "https://hooks.slack/TWO".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(c1.id, c2.id, "upsert keeps the same id");
    let got = store
        .get_channel(cipher.as_ref(), tenant.clone(), "team-slack")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        got.config,
        ChannelConfig::Slack {
            url: "https://hooks.slack/TWO".into()
        }
    );

    // Resolution by ids: unknown ids are absent, not errors.
    let resolved = store
        .channels_by_ids(cipher.as_ref(), &tenant, &[c2.id, Uuid::new_v4()])
        .await
        .unwrap();
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].name, "team-slack");

    // A referenced channel cannot be deleted; the referrers are named.
    store
        .create_receiver(
            tenant.clone(),
            "oncall",
            &["team-slack".to_string()],
            &BTreeMap::new(),
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .delete_channel(tenant.clone(), "team-slack")
            .await
            .unwrap(),
        ChannelDelete::InUse(vec!["oncall".to_string()])
    );
    assert_eq!(
        store
            .delete_receiver(tenant.clone(), "oncall")
            .await
            .unwrap(),
        ReceiverDelete::Deleted
    );
    assert_eq!(
        store
            .delete_channel(tenant.clone(), "team-slack")
            .await
            .unwrap(),
        ChannelDelete::Deleted
    );
    assert_eq!(
        store.delete_channel(tenant, "team-slack").await.unwrap(),
        ChannelDelete::NotFound
    );
}

/// The receiver-write channel check runs inside the write transaction (under a
/// `FOR KEY SHARE` lock on each channel row), so it is the authority that closes the
/// delete-vs-create race, not just the API boundary pre-check. Deterministic proxy for
/// that race: writing a receiver that references a channel which does not exist is
/// rejected with the missing names, exactly as the lock would report a channel a
/// concurrent delete had removed.
#[tokio::test]
async fn receiver_write_rejects_unknown_channels() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    let cipher = test_cipher();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "present",
            &ChannelConfig::Slack {
                url: "https://hooks.slack/OK".into(),
            },
        )
        .await
        .unwrap();

    // Upsert path: the missing name is reported and no receiver row is written.
    let outcome = store
        .create_receiver(
            tenant.clone(),
            "oncall",
            &["present".to_string(), "gone".to_string()],
            &BTreeMap::new(),
        )
        .await
        .unwrap();
    assert!(
        matches!(&outcome, ReceiverWrite::MissingChannels(names) if names == &vec!["gone".to_string()]),
        "expected MissingChannels([gone]), got {outcome:?}"
    );
    assert!(
        store
            .get_receiver(tenant.clone(), "oncall")
            .await
            .unwrap()
            .is_none(),
        "a rejected receiver write must not persist a row"
    );

    // Create-only path rejects the same way.
    let outcome = store
        .insert_receiver(
            tenant.clone(),
            "oncall",
            &["gone".to_string()],
            &BTreeMap::new(),
        )
        .await
        .unwrap();
    assert!(matches!(outcome, ReceiverWrite::MissingChannels(_)));
}

#[tokio::test]
async fn channel_secret_not_stored_cleartext() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    let cipher = test_cipher();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "chat",
            &ChannelConfig::Slack {
                url: "https://hooks.slack/SECRET-TOKEN".into(),
            },
        )
        .await
        .unwrap();

    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let raw: String = sqlx::query_scalar("SELECT config::text FROM channels WHERE tenant=$1")
        .bind(tenant.as_str())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        !raw.contains("SECRET-TOKEN"),
        "secret leaked at rest: {raw}"
    );
    // JSONB renders with a space after the colon: `"type": "slack"`.
    assert!(
        raw.contains("\"type\": \"slack\""),
        "discriminant should stay cleartext: {raw}"
    );

    let got = store
        .get_channel(cipher.as_ref(), tenant, "chat")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        got.config,
        ChannelConfig::Slack {
            url: "https://hooks.slack/SECRET-TOKEN".into()
        }
    );
}

// A receiver row written without annotations (relying on the column default) reads
// back as an empty map, and one without channel links reads back as an empty list.
#[tokio::test]
async fn bare_receiver_rows_default_to_empty_annotations_and_channels() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    // Raw insert omitting annotations and channel links.
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::query("INSERT INTO receivers (id, tenant, name) VALUES ($1,$2,$3)")
        .bind(Uuid::new_v4())
        .bind(tenant.as_str())
        .bind("legacy")
        .execute(&pool)
        .await
        .unwrap();

    let got = store
        .get_receiver(tenant.clone(), "legacy")
        .await
        .unwrap()
        .unwrap();
    assert!(got.annotations.is_empty(), "bare rows read as empty map");
    assert!(got.channels.is_empty(), "no links read as empty list");
    let listed = store.list_receivers(tenant).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].annotations.is_empty());
}

fn matcher(label: &str, value: &str) -> Matcher {
    Matcher {
        label: label.into(),
        op: MatchOp::Eq,
        value: value.into(),
    }
}
