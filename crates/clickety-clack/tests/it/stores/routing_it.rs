use cc::crypto::{EnvKeyring, SecretCipher};
use cc::domain::channel::ChannelConfig;
use cc::domain::ids::TenantId;
use cc::domain::routing::{MatchOp, Matcher};
use cc::stores::{ChannelDelete, PgStore};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use uuid::Uuid;

fn test_cipher() -> Arc<dyn SecretCipher> {
    Arc::new(
        EnvKeyring::new(
            HashMap::from([("v1".to_string(), [7u8; 32])]),
            "v1".to_string(),
        )
        .unwrap(),
    )
}

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

    let r1 = store
        .create_receiver(
            tenant.clone(),
            "ops",
            &["hook-a".to_string()],
            &BTreeMap::from([("team".to_string(), "core".to_string())]),
        )
        .await
        .unwrap();
    let r2 = store
        .create_receiver(
            tenant.clone(),
            "ops",
            &["hook-b".to_string()],
            &BTreeMap::from([("oncall".to_string(), "https://rota".to_string())]),
        )
        .await
        .unwrap();
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
    assert!(store.delete_receiver(tenant.clone(), "ops").await.unwrap());
    assert!(store.list_receivers(tenant).await.unwrap().is_empty());
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

    // Resolution by names: unknown names are absent, not errors.
    let resolved = store
        .channels_by_names(
            cipher.as_ref(),
            &tenant,
            &["team-slack".to_string(), "gone".to_string()],
        )
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
    assert!(store
        .delete_receiver(tenant.clone(), "oncall")
        .await
        .unwrap());
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

// A receiver row written before the annotations column existed (simulated by relying on
// the column default) reads back as an empty map.
#[tokio::test]
async fn old_receiver_rows_default_to_empty_annotations() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    // Raw insert omitting annotations, as a pre-migration writer would have done.
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::query("INSERT INTO receivers (id, tenant, name, channels) VALUES ($1,$2,$3,$4)")
        .bind(Uuid::new_v4())
        .bind(tenant.as_str())
        .bind("legacy")
        .bind(serde_json::json!(["legacy-webhook"]))
        .execute(&pool)
        .await
        .unwrap();

    let got = store
        .get_receiver(tenant.clone(), "legacy")
        .await
        .unwrap()
        .unwrap();
    assert!(got.annotations.is_empty(), "old rows read as empty map");
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
