use crate::support::create_test_rule;
use cc::domain::ids::{InstanceKey, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::rule::{RuleSpec, Severity};
use cc::domain::{Event, EventKind, EventStatus};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use time::OffsetDateTime;
use uuid::Uuid;

async fn store() -> (PgStore, impl Sized) {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    (store, ())
}

fn spec() -> RuleSpec {
    RuleSpec {
        sql: "SELECT 1".into(),
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec!["svc".into()],
        value_column: Some("v".into()),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    }
}

fn inst(rule: cc::domain::ids::RuleId, tenant: &TenantId, n: usize, value: f64) -> InstanceState {
    let labels = BTreeMap::from([("svc".to_string(), format!("svc-{n}"))]);
    let mut s = InstanceState::new_inactive(
        InstanceKey::new(rule, &labels),
        cc::domain::ids::SourceId::Rule(rule),
        tenant.clone(),
        labels,
    );
    s.status = Status::Firing;
    s.value = Some(value);
    s.last_seen = Some(OffsetDateTime::UNIX_EPOCH);
    s
}

#[tokio::test]
async fn persist_eval_batch_upserts_and_outboxes() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/persist_eval_batch_upserts_and_outboxes",
        &spec(),
    )
    .await;

    // Empty input is a no-op returning no ids.
    assert!(store
        .persist_eval_batch(&[], &[], None, None, None, None)
        .await
        .unwrap()
        .outbox_ids
        .is_empty());

    // Batch-insert 3 instances, 1 with an outbox event.
    let instances: Vec<InstanceState> = (0..3)
        .map(|i| inst(rule.id, &tenant, i, i as f64))
        .collect();
    let ev = Event {
        tenant: tenant.clone(),
        rule: rule.id,
        slo: None,
        name: rule.name.clone(),
        instance_key: instances[0].key.clone(),
        status: EventStatus::Firing,
        kind: EventKind::Alert,
        labels: instances[0].labels.clone(),
        value: Some(0.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
        traceparent: None,
    };
    let ids = store
        .persist_eval_batch(
            &instances,
            std::slice::from_ref(&ev),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap()
        .outbox_ids;
    assert_eq!(ids.len(), 1, "one outbox id per event");

    let loaded = store.load_instances(&rule.tenant, rule.id).await.unwrap();
    assert_eq!(loaded.len(), 3, "all instances persisted");

    // ON CONFLICT update: re-persist same keys with a new value.
    let updated: Vec<InstanceState> = (0..3).map(|i| inst(rule.id, &tenant, i, 99.0)).collect();
    store
        .persist_eval_batch(&updated, &[], None, None, None, None)
        .await
        .unwrap();
    let reloaded = store.load_instances(&rule.tenant, rule.id).await.unwrap();
    assert_eq!(reloaded.len(), 3, "still 3 (upsert, not insert)");
    assert!(
        reloaded.iter().all(|s| s.value == Some(99.0)),
        "values updated via ON CONFLICT"
    );

    // NULL columns: an inactive instance with value/active_since/last_seen all None must
    // round-trip through the unnest float8[]/timestamptz[] binds (the riskiest part).
    let null_labels = BTreeMap::from([("svc".to_string(), "null-case".to_string())]);
    let null_inst = InstanceState::new_inactive(
        InstanceKey::new(rule.id, &null_labels),
        cc::domain::ids::SourceId::Rule(rule.id),
        tenant.clone(),
        null_labels,
    );
    let null_key = null_inst.key.clone();
    store
        .persist_eval_batch(
            std::slice::from_ref(&null_inst),
            &[],
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
    let after = store.load_instances(&rule.tenant, rule.id).await.unwrap();
    let got = after
        .iter()
        .find(|s| s.key == null_key)
        .expect("null instance persisted");
    assert_eq!(got.value, None, "NULL value round-trips");
    assert_eq!(got.active_since, None, "NULL active_since round-trips");
    assert_eq!(got.last_seen, None, "NULL last_seen round-trips");

    // The outbox row exists; delete_outbox_batch removes it.
    store.delete_outbox_batch(&ids).await.unwrap();
    // A second delete of the same ids is a harmless no-op.
    store.delete_outbox_batch(&ids).await.unwrap();
}

/// The idempotency claim rides `persist_eval_batch`'s transaction: the first delivery of a
/// `(rule, eval_ts)` wins the claim and commits its state; a redelivery of the SAME
/// `(rule, eval_ts)` loses the claim, writes nothing, and reports `claimed == false` — so
/// the state is never double-applied and exactly one ledger row exists.
#[tokio::test]
async fn persist_eval_batch_claim_is_atomic_and_idempotent() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/persist_eval_batch_claim_is_atomic_and_idempotent",
        &spec(),
    )
    .await;
    let eval_ts = OffsetDateTime::from_unix_timestamp(1_700_000_000).unwrap();

    // First delivery: wins the claim, commits its firing instance at value 1.0.
    let first = store
        .persist_eval_batch(
            std::slice::from_ref(&inst(rule.id, &tenant, 0, 1.0)),
            &[],
            None,
            None,
            None,
            Some((rule.id, eval_ts)),
        )
        .await
        .unwrap();
    assert!(first.claimed, "first delivery must win the claim");

    // Second delivery of the SAME (rule, eval_ts) carries a different value; it must
    // lose the claim, so the state below stays at 1.0 and nothing is published.
    let second = store
        .persist_eval_batch(
            std::slice::from_ref(&inst(rule.id, &tenant, 0, 999.0)),
            &[],
            None,
            None,
            None,
            Some((rule.id, eval_ts)),
        )
        .await
        .unwrap();
    assert!(
        !second.claimed,
        "redelivery of the same eval_ts must lose the claim"
    );
    assert!(
        second.outbox_ids.is_empty(),
        "a lost claim writes no outbox rows"
    );

    let loaded = store.load_instances(&rule.tenant, rule.id).await.unwrap();
    assert_eq!(loaded.len(), 1, "exactly one instance");
    assert_eq!(
        loaded[0].value,
        Some(1.0),
        "the lost-claim redelivery must not overwrite the committed state"
    );

    // Exactly one ledger row for this (rule, eval_ts): the claim was recorded once.
    let ledger: i64 =
        sqlx::query_scalar("SELECT count(*) FROM evaluations WHERE rule = $1 AND eval_ts = $2")
            .bind(rule.id.0)
            .bind(eval_ts)
            .fetch_one(store.pool_for_test())
            .await
            .unwrap();
    assert_eq!(ledger, 1, "the claim ledger holds exactly one row");
}

/// A claim with an empty evaluation (no instances, no events) must still be recorded, so a
/// quiet eval_ts is marked applied and a redelivery is a no-op rather than re-running.
#[tokio::test]
async fn persist_eval_batch_claim_records_empty_eval() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/persist_eval_batch_claim_records_empty_eval",
        &spec(),
    )
    .await;
    let eval_ts = OffsetDateTime::from_unix_timestamp(1_700_000_100).unwrap();

    let first = store
        .persist_eval_batch(&[], &[], None, None, None, Some((rule.id, eval_ts)))
        .await
        .unwrap();
    assert!(first.claimed, "empty eval still wins and records the claim");
    let second = store
        .persist_eval_batch(&[], &[], None, None, None, Some((rule.id, eval_ts)))
        .await
        .unwrap();
    assert!(
        !second.claimed,
        "the recorded claim makes a redelivery a no-op"
    );
}
