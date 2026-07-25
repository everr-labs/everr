use crate::support::create_test_rule;
use async_trait::async_trait;
use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::rule::{RuleSpec, Severity};
use cc::evaluator::maintenance::{reconcile_once, reconcile_sweep, relay_once};
use cc::queue::event_bus::RedisEventBus;
use cc::queue::{EventBus, EventEntry, QueueError};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

/// EventBus that fails the first `remaining_failures` publishes, then delegates to the real bus.
struct FailNBus {
    inner: RedisEventBus,
    remaining_failures: AtomicUsize,
}

#[async_trait]
impl EventBus for FailNBus {
    async fn publish(&self, ev: &Event) -> Result<(), QueueError> {
        if self.remaining_failures.load(Ordering::SeqCst) > 0 {
            self.remaining_failures.fetch_sub(1, Ordering::SeqCst);
            return Err(crate::common::queue_error());
        }
        self.inner.publish(ev).await
    }
    async fn consume(&self, c: &str, n: usize, b: usize) -> Result<Vec<EventEntry>, QueueError> {
        self.inner.consume(c, n, b).await
    }
    async fn ack(&self, id: &cc::queue::EventId) -> Result<(), QueueError> {
        self.inner.ack(id).await
    }
    async fn dead_letter(&self, ev: &Event, reason: &str) -> Result<(), QueueError> {
        self.inner.dead_letter(ev, reason).await
    }
}

fn spec(interval_secs: u32) -> RuleSpec {
    RuleSpec {
        sql: "SELECT 1".into(),
        interval_secs,
        for_secs: 0,
        label_columns: vec![],
        value_column: None,
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    }
}

fn instance(
    rule: cc::domain::ids::RuleId,
    tenant: TenantId,
    name: &str,
    status: Status,
    last_seen: OffsetDateTime,
) -> InstanceState {
    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), name.to_string());
    let key = InstanceKey::new(rule, &labels);
    let mut s =
        InstanceState::new_inactive(key, cc::domain::ids::SourceId::Rule(rule), tenant, labels);
    s.status = status;
    s.last_seen = Some(last_seen);
    s.active_since = Some(last_seen);
    s
}

#[tokio::test]
async fn relay_publishes_stale_outbox_rows_and_deletes_them() {
    let pg_url = crate::support::fresh_db().await;
    let redis = crate::common::start_redis().await;
    let redis_url = redis.url.clone();

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus = RedisEventBus::connect(&redis_url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/relay_publishes_stale_outbox_rows_and_deletes_them",
        &spec(30),
    )
    .await;
    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), "api".to_string());
    let key = InstanceKey::new(rule.id, &labels);
    let mut inst = InstanceState::new_inactive(
        key.clone(),
        cc::domain::ids::SourceId::Rule(rule.id),
        tenant.clone(),
        labels.clone(),
    );
    inst.status = Status::Firing;
    let ev = Event::new(
        tenant,
        rule.id,
        key,
        EventStatus::Firing,
        labels,
        None,
        Severity::Critical,
        BTreeMap::new(),
        OffsetDateTime::UNIX_EPOCH,
    );

    store.upsert_instance_with_outbox(&inst, &ev).await.unwrap();

    let n = relay_once(
        &store,
        &bus,
        OffsetDateTime::now_utc() + Duration::hours(1),
        256,
    )
    .await
    .unwrap();
    assert_eq!(n, 1);

    let remaining = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 256)
        .await
        .unwrap();
    assert!(remaining.is_empty());

    let got = bus.consume("relay-test", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].event.status, EventStatus::Firing);
}

#[tokio::test]
async fn reconcile_resolves_stale_firing_and_clears_pending() {
    let pg_url = crate::support::fresh_db().await;
    let redis = crate::common::start_redis().await;
    let redis_url = redis.url.clone();

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus = RedisEventBus::connect(&redis_url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/reconcile_resolves_stale_firing_and_clears_pending",
        &spec(30),
    )
    .await; // threshold 120s
    let now = OffsetDateTime::now_utc();

    store
        .upsert_instance(&instance(
            rule.id,
            tenant.clone(),
            "stale-fire",
            Status::Firing,
            now - Duration::seconds(300),
        ))
        .await
        .unwrap();
    store
        .upsert_instance(&instance(
            rule.id,
            tenant.clone(),
            "stale-pend",
            Status::Pending,
            now - Duration::seconds(300),
        ))
        .await
        .unwrap();
    store
        .upsert_instance(&instance(
            rule.id,
            tenant,
            "fresh-fire",
            Status::Firing,
            now - Duration::seconds(10),
        ))
        .await
        .unwrap();

    let n = reconcile_once(&store, &bus, now).await.unwrap();
    assert_eq!(n, 2, "two stale instances reconciled");

    let loaded = store.load_instances(&rule.tenant, rule.id).await.unwrap();
    let by_name = |name: &str| {
        loaded
            .iter()
            .find(|i| i.labels.get("service").map(|s| s == name).unwrap_or(false))
            .unwrap()
            .status
    };
    assert_eq!(by_name("stale-fire"), Status::Inactive);
    assert_eq!(by_name("stale-pend"), Status::Inactive);
    assert_eq!(by_name("fresh-fire"), Status::Firing);

    let got = bus.consume("reconcile-test", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].event.status, EventStatus::Resolved);
    assert_eq!(got[0].event.labels.get("service").unwrap(), "stale-fire");

    let remaining = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 256)
        .await
        .unwrap();
    assert!(remaining.is_empty());
}

#[tokio::test]
async fn reconcile_sweep_drains_backlog_across_chunks() {
    let pg_url = crate::support::fresh_db().await;
    let redis = crate::common::start_redis().await;
    let redis_url = redis.url.clone();

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus = RedisEventBus::connect(&redis_url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/reconcile_sweep_drains_backlog_across_chunks",
        &spec(30),
    )
    .await; // threshold 120s
    let now = OffsetDateTime::now_utc();

    // Three stale firing instances; a batch of 2 forces two chunks (2 + 1).
    for name in ["stale-a", "stale-b", "stale-c"] {
        store
            .upsert_instance(&instance(
                rule.id,
                tenant.clone(),
                name,
                Status::Firing,
                now - Duration::seconds(300),
            ))
            .await
            .unwrap();
    }

    let n = reconcile_sweep(&store, &bus, now, 2).await.unwrap();
    assert_eq!(n, 3, "all three stale instances reconciled across chunks");

    // Every instance drained to Inactive — nothing left behind by the chunk boundary.
    let loaded = store.load_instances(&rule.tenant, rule.id).await.unwrap();
    assert_eq!(loaded.len(), 3);
    assert!(
        loaded.iter().all(|i| i.status == Status::Inactive),
        "all instances reset to Inactive"
    );

    // One Resolved event per firing instance, published through the outbox.
    let got = bus.consume("sweep-test", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 3, "one Resolved event per reconciled firing");
    assert!(got.iter().all(|e| e.event.status == EventStatus::Resolved));

    // Outbox fully drained — each chunk deleted its own rows after publish.
    let remaining = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 256)
        .await
        .unwrap();
    assert!(remaining.is_empty(), "outbox drained after sweep");

    // A re-run finds nothing stale (the set was fully consumed).
    let n2 = reconcile_sweep(&store, &bus, now, 2).await.unwrap();
    assert_eq!(n2, 0, "no stale instances remain");
}

#[tokio::test]
async fn relay_retries_when_publish_fails() {
    let pg_url = crate::support::fresh_db().await;
    let redis = crate::common::start_redis().await;
    let redis_url = redis.url.clone();

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus = FailNBus {
        inner: RedisEventBus::connect(&redis_url).await.unwrap(),
        remaining_failures: AtomicUsize::new(1),
    };

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/relay_retries_when_publish_fails",
        &spec(30),
    )
    .await;
    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), "api".to_string());
    let key = InstanceKey::new(rule.id, &labels);
    let mut inst = InstanceState::new_inactive(
        key.clone(),
        cc::domain::ids::SourceId::Rule(rule.id),
        tenant.clone(),
        labels.clone(),
    );
    inst.status = Status::Firing;
    let ev = Event::new(
        tenant,
        rule.id,
        key,
        EventStatus::Firing,
        labels,
        None,
        Severity::Critical,
        BTreeMap::new(),
        OffsetDateTime::UNIX_EPOCH,
    );
    store.upsert_instance_with_outbox(&inst, &ev).await.unwrap();

    let future = OffsetDateTime::now_utc() + Duration::hours(1);

    // First relay pass: publish fails -> row must remain, nothing republished.
    let n1 = relay_once(&store, &bus, future, 256).await.unwrap();
    assert_eq!(n1, 0, "publish failed, so nothing was republished");
    let still_there = store.claim_outbox(future, 256).await.unwrap();
    assert_eq!(
        still_there.len(),
        1,
        "row must remain after a failed publish"
    );

    // Second relay pass: publish now succeeds -> row republished and deleted.
    let n2 = relay_once(&store, &bus, future, 256).await.unwrap();
    assert_eq!(n2, 1, "publish succeeded on retry");
    let gone = store.claim_outbox(future, 256).await.unwrap();
    assert!(gone.is_empty(), "row deleted after successful republish");
}
