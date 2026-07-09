use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, TenantId};
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
        severity: Severity::Warning,
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

fn firing_instance(rule: cc::domain::ids::RuleId, tenant: TenantId) -> (InstanceState, Event) {
    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), "api".to_string());
    let key = InstanceKey::new(rule, &labels);
    let mut inst = InstanceState::new_inactive(key.clone(), rule, tenant.clone(), labels.clone());
    inst.status = Status::Firing;
    inst.value = Some(5.0);
    inst.last_seen = Some(OffsetDateTime::UNIX_EPOCH);
    let ev = Event::new(
        tenant,
        rule,
        key,
        EventStatus::Firing,
        labels,
        Some(5.0),
        Severity::Warning,
        BTreeMap::new(),
        OffsetDateTime::UNIX_EPOCH,
    );
    (inst, ev)
}

#[tokio::test]
async fn upsert_with_outbox_writes_both_and_claim_returns_event() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = store.create_rule(tenant.clone(), &spec()).await.unwrap();
    let (inst, ev) = firing_instance(rule.id, tenant);

    let id = store.upsert_instance_with_outbox(&inst, &ev).await.unwrap();

    let loaded = store.load_instances(&rule.tenant, rule.id).await.unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].status, Status::Firing);

    let claimed = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 100)
        .await
        .unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].0, id);
    assert_eq!(claimed[0].1, ev);

    store.delete_outbox(id).await.unwrap();
    let after = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 100)
        .await
        .unwrap();
    assert!(after.is_empty());
}

#[tokio::test]
async fn claim_respects_grace_cutoff() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = store.create_rule(tenant.clone(), &spec()).await.unwrap();
    let (inst, ev) = firing_instance(rule.id, tenant);
    store.upsert_instance_with_outbox(&inst, &ev).await.unwrap();

    let past = store
        .claim_outbox(OffsetDateTime::now_utc() - Duration::hours(1), 100)
        .await
        .unwrap();
    assert!(
        past.is_empty(),
        "fresh row must not be claimed before grace"
    );

    let future = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 100)
        .await
        .unwrap();
    assert_eq!(future.len(), 1);
}

#[tokio::test]
async fn upsert_with_outbox_rolls_back_on_failure() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    // instances.rule has a FK to rules(id); a non-existent rule id makes the instance
    // INSERT fail, so the whole transaction (including the outbox row) must roll back.
    let bogus_rule = cc::domain::ids::RuleId(Uuid::new_v4());
    let (mut inst, mut ev) = firing_instance(bogus_rule, tenant.clone());
    inst.rule = bogus_rule;
    ev.rule = bogus_rule;

    let res = store.upsert_instance_with_outbox(&inst, &ev).await;
    assert!(res.is_err(), "FK violation should fail the write");

    let claimed = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 100)
        .await
        .unwrap();
    assert!(
        claimed.is_empty(),
        "outbox row must roll back with the failed instance write"
    );
    assert!(
        store
            .load_instances(&tenant, bogus_rule)
            .await
            .unwrap()
            .is_empty(),
        "instance row must roll back too"
    );
}
