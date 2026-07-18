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
    let spec = RuleSpec {
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
    };
    let rule = store.create_rule(tenant.clone(), &spec).await.unwrap();

    // Empty input is a no-op returning no ids.
    assert!(store
        .persist_eval_batch(&[], &[], None, None, None)
        .await
        .unwrap()
        .is_empty());

    // Batch-insert 3 instances, 1 with an outbox event.
    let instances: Vec<InstanceState> = (0..3)
        .map(|i| inst(rule.id, &tenant, i, i as f64))
        .collect();
    let ev = Event {
        tenant: tenant.clone(),
        rule: rule.id,
        slo: None,
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
    };
    let ids = store
        .persist_eval_batch(&instances, std::slice::from_ref(&ev), None, None, None)
        .await
        .unwrap();
    assert_eq!(ids.len(), 1, "one outbox id per event");

    let loaded = store.load_instances(&rule.tenant, rule.id).await.unwrap();
    assert_eq!(loaded.len(), 3, "all instances persisted");

    // ON CONFLICT update: re-persist same keys with a new value.
    let updated: Vec<InstanceState> = (0..3).map(|i| inst(rule.id, &tenant, i, 99.0)).collect();
    store
        .persist_eval_batch(&updated, &[], None, None, None)
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
        .persist_eval_batch(std::slice::from_ref(&null_inst), &[], None, None, None)
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
