use crate::support::create_test_rule;
use cc::domain::event::{EventKind, EventStatus};
use cc::domain::ids::{InstanceKey, SourceId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::rule::{RuleSpec, Severity};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

fn spec() -> RuleSpec {
    RuleSpec {
        sql: "SELECT 1".into(),
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec![],
        value_column: None,
        severity: Severity::Info,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    }
}

async fn store() -> (PgStore, impl Sized) {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    (store, ())
}

// ---- Task 5: stale-reaper guard ----

#[tokio::test]
async fn degraded_rule_firing_instances_are_not_stale() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/degraded_rule_firing_instances_are_not_stale",
        &spec(),
    )
    .await;
    let now = OffsetDateTime::now_utc();

    // A firing instance well past the stale threshold (interval 30 -> threshold 120s).
    let key = InstanceKey::new(rule.id, &BTreeMap::new());
    let mut inst = InstanceState::new_inactive(
        key,
        SourceId::Rule(rule.id),
        tenant.clone(),
        BTreeMap::new(),
    );
    inst.status = Status::Firing;
    inst.active_since = Some(now - Duration::seconds(300));
    inst.last_seen = Some(now - Duration::seconds(300));
    store.upsert_instance(&inst).await.unwrap();

    // Healthy rule: instance IS stale.
    assert_eq!(
        store.list_stale_instances(now, 1000).await.unwrap().len(),
        1
    );

    // Degrade it (threshold 1), then it must NOT be stale.
    store
        .record_rule_failure(rule.id, &tenant, "boom", 1, now)
        .await
        .unwrap();
    assert_eq!(
        store.list_stale_instances(now, 1000).await.unwrap().len(),
        0
    );
}

/// A rule that is failing but not yet degraded (health_status stays 'healthy',
/// consecutive_failures > 0) froze deliberately (freeze-on-error): the reaper must not
/// resolve its instances before the degrade threshold decides. Closes the
/// reaper-vs-degrade race when `degrade_after` > 4 (the 4x-cadence staleness window).
#[tokio::test]
async fn failing_but_not_degraded_rule_firing_instances_are_not_stale() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/failing_but_not_degraded_rule_firing_instances_are_not_stale",
        &spec(),
    )
    .await;
    let now = OffsetDateTime::now_utc();

    let key = InstanceKey::new(rule.id, &BTreeMap::new());
    let mut inst = InstanceState::new_inactive(
        key,
        SourceId::Rule(rule.id),
        tenant.clone(),
        BTreeMap::new(),
    );
    inst.status = Status::Firing;
    inst.active_since = Some(now - Duration::seconds(300));
    inst.last_seen = Some(now - Duration::seconds(300));
    store.upsert_instance(&inst).await.unwrap();

    // One failure below a high threshold (5): health_status stays 'healthy',
    // consecutive_failures=1.
    assert!(store
        .record_rule_failure(rule.id, &tenant, "boom", 5, now)
        .await
        .unwrap()
        .is_none());

    // Despite the stale last_seen, the instance must NOT be returned: the rule froze
    // deliberately and hasn't crossed the degrade threshold yet.
    assert_eq!(
        store.list_stale_instances(now, 1000).await.unwrap().len(),
        0
    );
}

// ---- Task 6: record_rule_failure ----

#[tokio::test]
async fn failure_degrades_exactly_at_threshold() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/failure_degrades_exactly_at_threshold",
        &spec(),
    )
    .await;
    let now = OffsetDateTime::now_utc();

    // Below threshold (K=3): no event.
    assert!(store
        .record_rule_failure(rule.id, &tenant, "boom", 3, now)
        .await
        .unwrap()
        .is_none());
    assert!(store
        .record_rule_failure(rule.id, &tenant, "boom", 3, now)
        .await
        .unwrap()
        .is_none());

    // Third failure crosses K -> one Firing/RuleHealth event.
    let (ev, _id) = store
        .record_rule_failure(rule.id, &tenant, "boom", 3, now)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(ev.kind, EventKind::RuleHealth);
    assert_eq!(ev.status, EventStatus::Firing);
    assert_eq!(ev.severity, Severity::Critical);
    assert!(ev.annotations.get("summary").unwrap().contains("degraded"));
    assert_eq!(ev.annotations.get("last_error").unwrap(), "boom");

    // Already degraded: further failures emit nothing.
    assert!(store
        .record_rule_failure(rule.id, &tenant, "boom", 3, now)
        .await
        .unwrap()
        .is_none());
}

// ---- Task 7: record_rule_success ----

#[tokio::test]
async fn success_recovers_only_if_degraded() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/success_recovers_only_if_degraded",
        &spec(),
    )
    .await;
    let now = OffsetDateTime::now_utc();

    // Healthy success -> nothing.
    assert!(store
        .record_rule_success(rule.id, &tenant, now)
        .await
        .unwrap()
        .is_none());

    // Degrade it (K=1), then a success recovers with one Resolved event.
    assert!(store
        .record_rule_failure(rule.id, &tenant, "boom", 1, now)
        .await
        .unwrap()
        .is_some());
    let (ev, _id) = store
        .record_rule_success(rule.id, &tenant, now)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(ev.kind, EventKind::RuleHealth);
    assert_eq!(ev.status, EventStatus::Resolved);
    assert!(ev.annotations.get("summary").unwrap().contains("recovered"));

    // Second success: already healthy -> nothing.
    assert!(store
        .record_rule_success(rule.id, &tenant, now)
        .await
        .unwrap()
        .is_none());
}

// ---- Task 8: get_rule_with_health + list_rules_page ----

#[tokio::test]
async fn get_and_list_expose_health() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/get_and_list_expose_health",
        &spec(),
    )
    .await;
    let now = OffsetDateTime::now_utc();

    let (_r, h, _rollup, _updated_at) = store
        .get_rule_with_health(tenant.clone(), rule.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(h.status, "healthy");
    assert_eq!(h.consecutive_failures, 0);

    // Degrade and confirm get + filtered list reflect it.
    store
        .record_rule_failure(rule.id, &tenant, "boom", 1, now)
        .await
        .unwrap();
    let (_r, h, _rollup, _updated_at) = store
        .get_rule_with_health(tenant.clone(), rule.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(h.status, "degraded");
    assert_eq!(h.last_error.as_deref(), Some("boom"));

    let (all, _) = store
        .list_rules_page(&tenant, None, None, None, None, 100)
        .await
        .unwrap();
    assert_eq!(all.len(), 1);
    let (degraded, _) = store
        .list_rules_page(&tenant, Some("degraded"), None, None, None, 100)
        .await
        .unwrap();
    assert_eq!(degraded.len(), 1);
    let (healthy, _) = store
        .list_rules_page(&tenant, Some("healthy"), None, None, None, 100)
        .await
        .unwrap();
    assert_eq!(healthy.len(), 0);
}

// ---- suppressed (preview) rules: health events carry the flag ----

/// A suppressed rule must never notify, its rule-health events included: both the
/// degrade (Firing) and recovery (Resolved) events are stamped `suppressed: true`, and
/// the flag survives the outbox payload (rolling-relay path).
#[tokio::test]
async fn health_events_of_suppressed_rule_are_stamped() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let mut s = spec();
    s.suppressed = true;
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/health_events_of_suppressed_rule_are_stamped",
        &s,
    )
    .await;
    let now = OffsetDateTime::now_utc();

    let (ev, outbox_id) = store
        .record_rule_failure(rule.id, &tenant, "boom", 1, now)
        .await
        .unwrap()
        .expect("threshold 1 degrades on the first failure");
    assert_eq!(ev.kind, EventKind::RuleHealth);
    assert_eq!(ev.status, EventStatus::Firing);
    assert!(ev.suppressed, "degrade event carries the rule's flag");

    // The outbox payload (what the maintenance relay would re-publish) carries it too.
    let claimed = store
        .claim_outbox(now + Duration::seconds(60), 10)
        .await
        .unwrap();
    let (_, outbox_ev) = claimed
        .iter()
        .find(|(id, _)| *id == outbox_id)
        .expect("outbox row present");
    assert!(outbox_ev.suppressed);

    let (ev, _) = store
        .record_rule_success(rule.id, &tenant, now)
        .await
        .unwrap()
        .expect("recovery from degraded emits an event");
    assert_eq!(ev.status, EventStatus::Resolved);
    assert!(ev.suppressed, "recovery event carries the rule's flag");
}

/// Non-suppressed rules keep emitting unsuppressed health events (the `(spec->>
/// 'suppressed')::bool` read must not misfire on a normal spec).
#[tokio::test]
async fn health_events_of_normal_rule_are_not_stamped() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/health_events_of_normal_rule_are_not_stamped",
        &spec(),
    )
    .await;
    let now = OffsetDateTime::now_utc();

    let (ev, _) = store
        .record_rule_failure(rule.id, &tenant, "boom", 1, now)
        .await
        .unwrap()
        .expect("threshold 1 degrades on the first failure");
    assert!(!ev.suppressed);
}
