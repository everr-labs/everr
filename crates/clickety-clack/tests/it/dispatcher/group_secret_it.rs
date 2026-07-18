//! Secret hygiene of the group buffer: metas carry channel NAMES only, so no secret
//! ever reaches Redis, and the flusher resolves names to their stored configs at
//! delivery time — a secret rotation between buffering and flush is picked up.

use cc::crypto::{EnvKeyring, SecretCipher};
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::notify::WebhookNotifier;
use cc::dispatcher::{flush_group, grouping, process_event, Notifiers};
use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::receiver::ChannelConfig;
use cc::domain::rule::Severity;
use cc::domain::sink::NullSink;
use cc::queue::event_bus::RedisEventBus;
use cc::queue::groups::{GroupStore, RedisGroups};
use cc::queue::EventBus;
use cc::stores::PgStore;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;
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

fn sample_event(tenant: TenantId) -> Event {
    Event {
        tenant,
        rule: RuleId(Uuid::nil()),
        slo: None,
        instance_key: InstanceKey("k".into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    }
}

#[tokio::test]
async fn group_hash_holds_no_secret_and_flush_uses_the_rotated_config() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());
    let cipher = test_cipher();

    // Two webhook endpoints whose URLs carry a secret token: the original config and
    // the rotated one it is replaced with between buffering and flush.
    let old_hits = Arc::new(Mutex::new(0usize));
    let old_url = format!("{}?token=SECRET-XYZ", start_webhook(old_hits.clone()).await);
    let new_hits = Arc::new(Mutex::new(0usize));
    let new_url = format!(
        "{}?token=ROTATED-SECRET",
        start_webhook(new_hits.clone()).await
    );

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let receiver_name = "oncall";
    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook {
                url: old_url.clone(),
            },
        )
        .await
        .unwrap();
    store
        .create_receiver(
            tenant.clone(),
            receiver_name,
            &["oncall-hook".to_string()],
            &std::collections::BTreeMap::new(),
        )
        .await
        .unwrap();
    store
        .create_route(
            tenant.clone(),
            &[],
            receiver_name,
            false,
            0,
            None,
            Some(0), // group_wait 0s: arm a due flush immediately
            Some(0),
            None, // repeat_interval_secs
        )
        .await
        .unwrap();

    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());
    let cache = FilterCache::with_ttl(store.clone(), Duration::ZERO);

    // Buffer through the real ingest path, exactly as the dispatcher does.
    let event = sample_event(tenant.clone());
    bus.publish(&event).await.unwrap();
    let entries = bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);
    let acked = process_event(
        &store,
        bus.as_ref(),
        notifiers.as_ref(),
        groups.as_ref(),
        &cache,
        cipher.as_ref(),
        &NullSink,
        &entries[0],
    )
    .await;
    assert!(acked, "routed event should ack after buffering");

    // Raw Redis read of the whole group hash: only the channel NAME is buffered; the
    // secret-bearing URL must not be present anywhere.
    let group_by = grouping::default_group_by();
    let labels = cc::dispatcher::routing::match_labels(&event);
    let values = grouping::group_by_values(&labels, &group_by);
    let gid = grouping::group_id(&tenant, receiver_name, &group_by, &values);
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let raw: Vec<String> = redis::cmd("HGETALL")
        .arg(format!("cc:group:{gid}"))
        .query_async(&mut conn)
        .await
        .unwrap();
    let flat = raw.join("\n");
    assert!(
        !flat.contains("SECRET-XYZ"),
        "secret leaked into Redis: {flat}"
    );
    assert!(
        flat.contains("oncall-hook"),
        "meta should carry the channel name: {flat}"
    );

    // Rotate the channel's secret between buffering and flush (upsert by name).
    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook {
                url: new_url.clone(),
            },
        )
        .await
        .unwrap();

    // Flush resolves the buffered name to the CURRENT stored config.
    flush_group(
        &store,
        bus.as_ref(),
        notifiers.as_ref(),
        groups.as_ref(),
        &cache,
        cipher.as_ref(),
        &NullSink,
        &gid,
    )
    .await;

    assert_eq!(
        *old_hits.lock().unwrap(),
        0,
        "the pre-rotation endpoint must not be hit"
    );
    assert_eq!(
        *new_hits.lock().unwrap(),
        1,
        "flush delivers to the config stored at delivery time"
    );
}
