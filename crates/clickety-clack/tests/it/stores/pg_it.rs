use cc::domain::ids::{SourceId, TenantId};
use cc::domain::rule::{RuleSpec, Severity};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use time::OffsetDateTime;
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

#[tokio::test]
async fn rule_crud_and_claim_due() {
    let url = crate::support::fresh_db().await;

    let store = PgStore::connect(&url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = store.create_rule(tenant.clone(), &spec()).await.unwrap();
    assert!(store
        .get_rule(tenant.clone(), rule.id)
        .await
        .unwrap()
        .is_some());

    // create_rule arms next_eval at the rule's jitter phase within one interval
    // (anti-thundering-herd), so claim past a full interval to see it due.
    let now = OffsetDateTime::now_utc() + time::Duration::seconds(31);
    let due = store.claim_due_rules(now, 100).await.unwrap();
    assert_eq!(due.len(), 1);
    let due2 = store.claim_due_rules(now, 100).await.unwrap();
    assert_eq!(due2.len(), 0);

    let ts = OffsetDateTime::UNIX_EPOCH;
    assert!(store.try_claim_eval(rule.id, ts).await.unwrap());
    assert!(!store.try_claim_eval(rule.id, ts).await.unwrap());

    assert!(store.delete_rule(tenant, rule.id).await.unwrap());
}

#[tokio::test]
async fn instance_upsert_and_load_roundtrip() {
    use cc::domain::ids::InstanceKey;
    use cc::domain::instance::{InstanceState, Status};

    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = store.create_rule(tenant.clone(), &spec()).await.unwrap();

    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), "api".to_string());
    let key = InstanceKey::new(rule.id, &labels);
    let mut inst =
        InstanceState::new_inactive(key.clone(), SourceId::Rule(rule.id), tenant, labels.clone());
    inst.status = Status::Firing;
    inst.value = Some(42.0);
    inst.absent_count = 3;

    store.upsert_instance(&inst).await.unwrap();
    let loaded = store.load_instances(&rule.tenant, rule.id).await.unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].key, key);
    assert_eq!(loaded[0].status, Status::Firing);
    assert_eq!(loaded[0].value, Some(42.0));
    assert_eq!(loaded[0].absent_count, 3);
    assert_eq!(loaded[0].labels, labels);

    // upsert again with new values -> second write wins
    let mut inst2 = inst.clone();
    inst2.value = Some(7.0);
    inst2.absent_count = 0;
    store.upsert_instance(&inst2).await.unwrap();
    let loaded2 = store.load_instances(&rule.tenant, rule.id).await.unwrap();
    assert_eq!(loaded2.len(), 1);
    assert_eq!(loaded2[0].value, Some(7.0));
    assert_eq!(loaded2[0].absent_count, 0);
}

#[tokio::test]
async fn list_alerts_excludes_inactive() {
    use cc::domain::ids::InstanceKey;
    use cc::domain::instance::{InstanceState, Status};

    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = store.create_rule(tenant.clone(), &spec()).await.unwrap();

    let mk = |name: &str, status: Status| {
        let mut labels = BTreeMap::new();
        labels.insert("service".to_string(), name.to_string());
        let key = InstanceKey::new(rule.id, &labels);
        let mut s =
            InstanceState::new_inactive(key, SourceId::Rule(rule.id), tenant.clone(), labels);
        s.status = status;
        s
    };

    store
        .upsert_instance(&mk("a", Status::Firing))
        .await
        .unwrap();
    store
        .upsert_instance(&mk("b", Status::Inactive))
        .await
        .unwrap();

    let alerts = store.list_alerts(tenant).await.unwrap();
    assert_eq!(alerts.len(), 1, "only the firing instance should be listed");
    assert_eq!(alerts[0].status, Status::Firing);
}

#[tokio::test]
async fn create_rule_name_conflict_within_namespace() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    let first = store
        .create_rule(tenant.clone(), "", "default/api-errors", &spec())
        .await
        .unwrap();
    assert!(matches!(first, cc::stores::RuleCreate::Created(_)));
    // Same (tenant, namespace, name): conflict.
    let dup = store
        .create_rule(tenant.clone(), "", "default/api-errors", &spec())
        .await
        .unwrap();
    assert!(matches!(dup, cc::stores::RuleCreate::NameConflict));
    // Same name in a different namespace: fine (live vs preview copies).
    let preview = store
        .create_rule(tenant.clone(), "pv-123", "default/api-errors", &spec())
        .await
        .unwrap();
    assert!(matches!(preview, cc::stores::RuleCreate::Created(_)));
}
