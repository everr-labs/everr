use cc::crypto::{EnvKeyring, SecretCipher};
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::dedup::dedup_key;
use cc::dispatcher::notify::WebhookNotifier;
use cc::dispatcher::{flush_group, grouping, process_event, run_dispatcher, Notifiers};
use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::receiver::ChannelConfig;
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::{RuleSpec, Severity};
use cc::domain::sink::{AlertLogSink, DeliveryFacts};
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

fn ev(tenant: TenantId) -> Event {
    Event {
        tenant,
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("svc=api".into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::new(),
        value: Some(1.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    }
}

#[tokio::test]
async fn dispatcher_delivers_once_and_dedups() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());
    let cipher = test_cipher();

    let hits = Arc::new(Mutex::new(0usize));
    let url = start_webhook(hits.clone()).await;

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_subscription(cipher.as_ref(), tenant.clone(), &url)
        .await
        .unwrap();

    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());
    let cache = Arc::new(FilterCache::new(store.clone()));
    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let handle = {
        let store = store.clone();
        let bus = bus.clone();
        let groups = groups.clone();
        let cache = cache.clone();
        let cipher = cipher.clone();
        tokio::spawn(async move {
            run_dispatcher(
                "d1".into(),
                store,
                bus,
                notifiers,
                groups,
                cache,
                cipher,
                std::sync::Arc::new(cc::domain::sink::NullSink),
                sd_rx,
            )
            .await;
        })
    };

    bus.publish(&ev(tenant.clone())).await.unwrap();
    bus.publish(&ev(tenant.clone())).await.unwrap();

    for _ in 0..50 {
        if *hits.lock().unwrap() >= 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;

    assert_eq!(
        *hits.lock().unwrap(),
        1,
        "dedup must prevent the second delivery"
    );
    let key = dedup_key("webhook", &url, &ev(tenant.clone()));
    assert_eq!(
        store
            .notification_status(&tenant, &key)
            .await
            .unwrap()
            .unwrap()
            .0,
        "sent"
    );

    let _ = sd_tx.send(true);
    let _ = handle.await;
}

/// Capturing `AlertLogSink` that records every `(event, facts)` pair so a test can assert
/// the dispatcher emitted the expected delivery/silenced alert-log records.
#[derive(Clone, Default)]
struct CapturingSink {
    calls: Arc<Mutex<Vec<(Event, DeliveryFacts)>>>,
}

#[async_trait::async_trait]
impl AlertLogSink for CapturingSink {
    async fn record_delivery(&self, ev: &Event, facts: &DeliveryFacts) {
        self.calls.lock().unwrap().push((ev.clone(), facts.clone()));
    }
}

fn ev_svc(tenant: TenantId, svc: &str) -> Event {
    let mut labels = BTreeMap::new();
    labels.insert("svc".to_string(), svc.to_string());
    Event {
        tenant,
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey(format!("svc={svc}")),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels,
        value: Some(1.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    }
}

/// A delivered event (firehose webhook path, no routes) emits exactly one `delivery`
/// alert-log record carrying the delivery target, and no `silenced` record.
#[tokio::test]
async fn delivery_emits_a_delivery_record() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());
    let cipher = test_cipher();

    let hits = Arc::new(Mutex::new(0usize));
    let url = start_webhook(hits.clone()).await;

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_subscription(cipher.as_ref(), tenant.clone(), &url)
        .await
        .unwrap();

    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());
    // No routes for this tenant -> the firehose webhook path delivers immediately.
    let cache = FilterCache::new(store.clone());
    let sink = CapturingSink::default();

    let event = ev_svc(tenant.clone(), "api");
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
        &sink,
        &entries[0],
    )
    .await;
    assert!(acked, "delivered event should ack");

    assert_eq!(
        *hits.lock().unwrap(),
        1,
        "webhook should have been hit once"
    );
    let calls = sink.calls.lock().unwrap();
    assert_eq!(
        calls.len(),
        1,
        "exactly one alert-log record; got {calls:?}"
    );
    let (rec_ev, facts) = &calls[0];
    assert_eq!(rec_ev.instance_key, event.instance_key);
    assert!(!facts.silenced, "delivery record must not be silenced");
    assert_eq!(facts.silence_id, None);
    assert_eq!(
        facts.delivery_targets,
        vec!["webhook".to_string()],
        "delivery target is the firehose webhook channel"
    );
}

/// A grouped delivery (routed event, buffered then flushed) emits a `delivery` alert-log
/// record whose target is the CLEAN receiver name — not the `receiver|k=v,...` group key.
/// Driven deterministically: buffer via `process_event`, then flush the known group id
/// directly (no flusher loop / sleeps).
#[tokio::test]
async fn grouped_delivery_uses_clean_receiver_name() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());
    let cipher = test_cipher();

    let hits = Arc::new(Mutex::new(0usize));
    let url = start_webhook(hits.clone()).await;

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    // A receiver + a catch-all route make this the routed (grouping) path, not the firehose.
    let receiver_name = "oncall";
    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook { url: url.clone() },
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
    // Zero TTL so the snapshot reflects the receiver/route we just created.
    let cache = FilterCache::with_ttl(store.clone(), Duration::ZERO);
    let sink = CapturingSink::default();

    let event = ev_svc(tenant.clone(), "api");
    bus.publish(&event).await.unwrap();
    let entries = bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);

    // Buffer the event into its group (arms a flush timer).
    let acked = process_event(
        &store,
        bus.as_ref(),
        notifiers.as_ref(),
        groups.as_ref(),
        &cache,
        cipher.as_ref(),
        &sink,
        &entries[0],
    )
    .await;
    assert!(acked, "routed event should ack after buffering");
    assert_eq!(
        *hits.lock().unwrap(),
        0,
        "grouped path defers delivery to flush"
    );

    // Recompute the deterministic group id (default group_by: rule, severity) and flush it
    // directly — same code path the flusher loop drives, without any timing.
    let group_by = grouping::default_group_by();
    let labels = cc::dispatcher::routing::match_labels(&event);
    let values = grouping::group_by_values(&labels, &group_by);
    let gid = grouping::group_id(&tenant, receiver_name, &group_by, &values);

    flush_group(
        &store,
        bus.as_ref(),
        notifiers.as_ref(),
        groups.as_ref(),
        &cache,
        cipher.as_ref(),
        &sink,
        &gid,
    )
    .await;

    assert_eq!(
        *hits.lock().unwrap(),
        1,
        "grouped delivery hits the webhook once"
    );
    let calls = sink.calls.lock().unwrap();
    assert_eq!(calls.len(), 1, "exactly one delivery record; got {calls:?}");
    let (_, facts) = &calls[0];
    assert!(!facts.silenced, "delivery record must not be silenced");
    assert_eq!(
        facts.delivery_targets,
        vec![receiver_name.to_string()],
        "grouped delivery target is the clean receiver name, not the group key"
    );
}

/// A silenced event emits exactly one `silenced` alert-log record carrying the matching
/// silence id and no delivery (the webhook is never hit).
#[tokio::test]
async fn silenced_event_emits_a_silenced_record() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());
    let cipher = test_cipher();

    let hits = Arc::new(Mutex::new(0usize));
    let url = start_webhook(hits.clone()).await;

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_subscription(cipher.as_ref(), tenant.clone(), &url)
        .await
        .unwrap();

    // Active silence covering svc=api.
    let now = OffsetDateTime::now_utc();
    let silence = store
        .create_silence(
            tenant.clone(),
            &[Matcher {
                label: "svc".into(),
                op: MatchOp::Eq,
                value: "api".into(),
            }],
            now - time::Duration::seconds(5),
            now + time::Duration::hours(1),
            "maint",
            "ops",
        )
        .await
        .unwrap();

    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());
    // Zero TTL so the snapshot reflects the silence we just created.
    let cache = FilterCache::with_ttl(store.clone(), Duration::ZERO);
    let sink = CapturingSink::default();

    let event = ev_svc(tenant.clone(), "api");
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
        &sink,
        &entries[0],
    )
    .await;
    assert!(acked, "silenced event is dropped but still acked");

    assert_eq!(
        *hits.lock().unwrap(),
        0,
        "silenced event must not be delivered"
    );
    let calls = sink.calls.lock().unwrap();
    assert_eq!(calls.len(), 1, "exactly one silenced record; got {calls:?}");
    let (_, facts) = &calls[0];
    assert!(facts.silenced, "record must be marked silenced");
    assert_eq!(
        facts.silence_id.as_deref(),
        Some(silence.id.to_string().as_str()),
        "silenced record carries the matching silence id"
    );
    assert!(
        facts.delivery_targets.is_empty(),
        "silenced events have no delivery targets"
    );
}

/// A late-arriving silence (created AFTER the event is buffered into its group) only takes
/// effect at FLUSH time. It must still emit exactly one `silenced` alert-log record carrying
/// the matching silence id, and the event must not be delivered. Driven deterministically:
/// buffer via `process_event` (no silence yet), create the silence, then flush the known
/// group id directly.
#[tokio::test]
async fn flush_time_silence_emits_a_silenced_record() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());
    let cipher = test_cipher();

    let hits = Arc::new(Mutex::new(0usize));
    let url = start_webhook(hits.clone()).await;

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    // Routed (grouping) path so the event is buffered, not delivered at ingest.
    let receiver_name = "oncall";
    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook { url: url.clone() },
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
    // Zero TTL so the flush-time snapshot reflects the silence we create after buffering.
    let cache = FilterCache::with_ttl(store.clone(), Duration::ZERO);
    let sink = CapturingSink::default();

    let event = ev_svc(tenant.clone(), "api");
    bus.publish(&event).await.unwrap();
    let entries = bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);

    // Buffer the event into its group (no silence exists yet → not suppressed at ingest).
    let acked = process_event(
        &store,
        bus.as_ref(),
        notifiers.as_ref(),
        groups.as_ref(),
        &cache,
        cipher.as_ref(),
        &sink,
        &entries[0],
    )
    .await;
    assert!(acked, "routed event should ack after buffering");
    assert_eq!(
        *hits.lock().unwrap(),
        0,
        "grouped path defers delivery to flush"
    );
    assert!(
        sink.calls.lock().unwrap().is_empty(),
        "no record at ingest: the silence does not exist yet"
    );

    // The silence arrives LATE, after the event is already buffered.
    let now = OffsetDateTime::now_utc();
    let silence = store
        .create_silence(
            tenant.clone(),
            &[Matcher {
                label: "svc".into(),
                op: MatchOp::Eq,
                value: "api".into(),
            }],
            now - time::Duration::seconds(5),
            now + time::Duration::hours(1),
            "maint",
            "ops",
        )
        .await
        .unwrap();

    // Flush the deterministic group id directly (same path the flusher loop drives).
    let group_by = grouping::default_group_by();
    let labels = cc::dispatcher::routing::match_labels(&event);
    let values = grouping::group_by_values(&labels, &group_by);
    let gid = grouping::group_id(&tenant, receiver_name, &group_by, &values);

    flush_group(
        &store,
        bus.as_ref(),
        notifiers.as_ref(),
        groups.as_ref(),
        &cache,
        cipher.as_ref(),
        &sink,
        &gid,
    )
    .await;

    assert_eq!(
        *hits.lock().unwrap(),
        0,
        "event suppressed by the late silence must not be delivered"
    );
    let calls = sink.calls.lock().unwrap();
    assert_eq!(
        calls.len(),
        1,
        "exactly one silenced record from the flush-time suppression; got {calls:?}"
    );
    let (rec_ev, facts) = &calls[0];
    assert_eq!(rec_ev.instance_key, event.instance_key);
    assert!(facts.silenced, "record must be marked silenced");
    assert_eq!(
        facts.silence_id.as_deref(),
        Some(silence.id.to_string().as_str()),
        "silenced record carries the matching silence id"
    );
    assert!(
        facts.delivery_targets.is_empty(),
        "silenced events have no delivery targets"
    );
}

/// An event dropped by an INHIBITION at flush time must emit NO alert-log record (no
/// event_type exists for inhibition; out of scope). Driven deterministically: buffer the
/// target event (no inhibition active yet), then create the inhibition rule + firing source,
/// then flush directly.
#[tokio::test]
async fn flush_time_inhibition_emits_no_record() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());
    let cipher = test_cipher();

    let hits = Arc::new(Mutex::new(0usize));
    let url = start_webhook(hits.clone()).await;

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let receiver_name = "oncall";
    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook { url: url.clone() },
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
            Some(0),
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
    let sink = CapturingSink::default();

    // Target event: severity=warning, svc=db (Severity::Warning so synthetic "severity"
    // label matches the inhibition target_matchers).
    let mut target_labels = BTreeMap::new();
    target_labels.insert("svc".to_string(), "db".to_string());
    let target = Event {
        tenant: tenant.clone(),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("svc=db".into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: target_labels,
        value: Some(1.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    };
    bus.publish(&target).await.unwrap();
    let entries = bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);

    // Buffer the target (no inhibition active yet → survives ingest, gets grouped).
    let acked = process_event(
        &store,
        bus.as_ref(),
        notifiers.as_ref(),
        groups.as_ref(),
        &cache,
        cipher.as_ref(),
        &sink,
        &entries[0],
    )
    .await;
    assert!(acked, "target event should ack after buffering");
    assert_eq!(
        *hits.lock().unwrap(),
        0,
        "grouped path defers delivery to flush"
    );
    assert!(
        sink.calls.lock().unwrap().is_empty(),
        "no record at ingest: the inhibition does not exist yet"
    );

    // Inhibition arrives LATE: a firing critical svc=db source + a rule inhibiting warnings.
    let now = OffsetDateTime::now_utc();
    let spec = RuleSpec {
        sql: "SELECT 1 AS n".into(),
        interval_secs: 1,
        for_secs: 0,
        label_columns: vec![],
        value_column: Some("n".into()),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    };
    let src_rule = store.create_rule(tenant.clone(), &spec).await.unwrap();
    let mut src_labels = BTreeMap::new();
    src_labels.insert("svc".to_string(), "db".to_string());
    let src_key = InstanceKey::new(src_rule.id, &src_labels);
    let mut firing =
        InstanceState::new_inactive(src_key.clone(), src_rule.id, tenant.clone(), src_labels);
    firing.status = Status::Firing;
    firing.active_since = Some(now);
    store.upsert_instance(&firing).await.unwrap();
    store
        .create_inhibition(
            tenant.clone(),
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "warning".into(),
            }],
            &["svc".to_string()],
        )
        .await
        .unwrap();

    // Flush the deterministic group id directly.
    let group_by = grouping::default_group_by();
    let labels = cc::dispatcher::routing::match_labels(&target);
    let values = grouping::group_by_values(&labels, &group_by);
    let gid = grouping::group_id(&tenant, receiver_name, &group_by, &values);

    flush_group(
        &store,
        bus.as_ref(),
        notifiers.as_ref(),
        groups.as_ref(),
        &cache,
        cipher.as_ref(),
        &sink,
        &gid,
    )
    .await;

    assert_eq!(
        *hits.lock().unwrap(),
        0,
        "event inhibited at flush time must not be delivered"
    );
    assert!(
        sink.calls.lock().unwrap().is_empty(),
        "inhibition flush-drop must emit NO alert-log record; got {:?}",
        *sink.calls.lock().unwrap()
    );
}
