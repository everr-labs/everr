//! Suppressed (preview-rule) events must never notify: the dispatcher drops them at
//! ingest, before silence/inhibition processing, before group buffering (routed tenants)
//! and before the subscription firehose (no-routes tenants).

use cc::crypto::{EnvKeyring, SecretCipher};
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::notify::WebhookNotifier;
use cc::dispatcher::{process_event, Notifiers};
use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::receiver::ChannelConfig;
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::Severity;
use cc::domain::sink::NullSink;
use cc::queue::event_bus::RedisEventBus;
use cc::queue::groups::{GroupStore, RedisGroups};
use cc::queue::{EventBus, EventEntry};
use cc::stores::PgStore;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
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

async fn start_webhook(hits: Arc<Mutex<usize>>) -> String {
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route(
        "/hook",
        post(move || {
            let hits = hits.clone();
            async move {
                *hits.lock().unwrap() += 1;
                "ok"
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{addr}/hook")
}

fn suppressed_event(tenant: TenantId) -> Event {
    Event {
        tenant,
        rule: RuleId(Uuid::nil()),
        slo: None,
        instance_key: InstanceKey("svc=api".into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::from([("svc".to_string(), "api".to_string())]),
        value: Some(1.0),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: true,
        evidence: None,
        evidence_truncated: false,
    }
}

struct Harness {
    store: PgStore,
    bus: Arc<dyn EventBus>,
    groups: Arc<dyn GroupStore>,
    cache: Arc<FilterCache>,
    cipher: Arc<dyn SecretCipher>,
    notifiers: Arc<Notifiers>,
}

async fn harness() -> Harness {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );
    std::mem::forget(redis);

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());
    let cipher = test_cipher();
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());
    let cache = Arc::new(FilterCache::new(store.clone()));
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    Harness {
        store,
        bus,
        groups,
        cache,
        cipher,
        notifiers: Arc::new(reg),
    }
}

/// Round-trip an event through the real bus so we get a consumable `EventEntry`
/// (its id is crate-private). Consumer names must be unique per call.
async fn entry_for(bus: &Arc<dyn EventBus>, ev: &Event, consumer: &str) -> EventEntry {
    bus.publish(ev).await.unwrap();
    let mut entries = bus.consume(consumer, 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);
    entries.remove(0)
}

/// Routed tenant: a suppressed event is acked (returns true) and buffers NOTHING into
/// its group, so no flush can ever deliver it.
#[tokio::test]
async fn suppressed_event_is_dropped_before_grouping() {
    let h = harness().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let hits = Arc::new(Mutex::new(0usize));
    let url = start_webhook(hits.clone()).await;

    h.store
        .create_channel(
            h.cipher.as_ref(),
            tenant.clone(),
            "ops-hook",
            &ChannelConfig::Webhook { url: url.clone() },
        )
        .await
        .unwrap();
    h.store
        .create_receiver(
            tenant.clone(),
            "ops",
            &["ops-hook".to_string()],
            &std::collections::BTreeMap::new(),
        )
        .await
        .unwrap();
    h.store
        .create_route(
            tenant.clone(),
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            "ops",
            false,
            0,
            None,
            Some(0),
            None,
            None, // repeat_interval_secs
        )
        .await
        .unwrap();

    let entry = entry_for(&h.bus, &suppressed_event(tenant), "grp-c1").await;
    let acked = process_event(
        &h.store,
        h.bus.as_ref(),
        h.notifiers.as_ref(),
        h.groups.as_ref(),
        h.cache.as_ref(),
        h.cipher.as_ref(),
        &NullSink,
        &entry,
    )
    .await;

    assert!(acked, "a suppressed event is dropped, not left in the PEL");
    // Nothing was buffered: no group ever becomes due, even far in the future.
    let far_future = i64::MAX / 2;
    let due = h.groups.claim_due(far_future, 32).await.unwrap();
    assert!(
        due.is_empty(),
        "suppressed event must not create a notification group: {due:?}"
    );
    assert_eq!(*hits.lock().unwrap(), 0, "no delivery of any kind");
}

/// No-routes tenant: a suppressed event skips the subscription firehose entirely: the
/// webhook is never called and no notification row is even begun.
#[tokio::test]
async fn suppressed_event_is_dropped_before_subscription_firehose() {
    let h = harness().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let hits = Arc::new(Mutex::new(0usize));
    let url = start_webhook(hits.clone()).await;

    h.store
        .create_subscription(h.cipher.as_ref(), tenant.clone(), &url)
        .await
        .unwrap();

    let ev = suppressed_event(tenant.clone());
    let entry = entry_for(&h.bus, &ev, "fh-c1").await;
    let acked = process_event(
        &h.store,
        h.bus.as_ref(),
        h.notifiers.as_ref(),
        h.groups.as_ref(),
        h.cache.as_ref(),
        h.cipher.as_ref(),
        &NullSink,
        &entry,
    )
    .await;

    assert!(acked, "a suppressed event is dropped, not left in the PEL");
    assert_eq!(*hits.lock().unwrap(), 0, "firehose must not deliver");
    let key = cc::dispatcher::dedup_key("webhook", &url, &ev);
    assert_eq!(
        h.store.notification_status(&tenant, &key).await.unwrap(),
        None,
        "no notification row is begun for a suppressed event"
    );

    // Sanity check: the same pipeline delivers a NON-suppressed event, so the zero
    // above is the suppression at work rather than a broken harness.
    let mut live = suppressed_event(TenantId::from_trusted("ignored".to_string()));
    live.tenant = ev.tenant.clone();
    live.suppressed = false;
    let entry = entry_for(&h.bus, &live, "fh-c2").await;
    let acked = process_event(
        &h.store,
        h.bus.as_ref(),
        h.notifiers.as_ref(),
        h.groups.as_ref(),
        h.cache.as_ref(),
        h.cipher.as_ref(),
        &NullSink,
        &entry,
    )
    .await;
    assert!(acked);
    assert_eq!(
        *hits.lock().unwrap(),
        1,
        "non-suppressed event on the same path delivers"
    );
}
