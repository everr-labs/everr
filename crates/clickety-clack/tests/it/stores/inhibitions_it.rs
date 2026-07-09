use cc::domain::ids::{InstanceKey, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::{RuleSpec, Severity};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use time::OffsetDateTime;
use uuid::Uuid;

async fn store() -> PgStore {
    let url = crate::support::fresh_db().await;
    let s = PgStore::connect(&url).await.unwrap();
    s
}

fn m(label: &str, value: &str) -> Matcher {
    Matcher {
        label: label.into(),
        op: MatchOp::Eq,
        value: value.into(),
    }
}

#[tokio::test]
async fn inhibition_crud() {
    let store = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    let rule = store
        .create_inhibition(
            tenant.clone(),
            &[m("severity", "critical")],
            &[m("severity", "warning")],
            &["instance".to_string()],
        )
        .await
        .unwrap();
    assert_eq!(
        store.list_inhibitions(tenant.clone()).await.unwrap().len(),
        1
    );
    assert!(store
        .delete_inhibition(tenant.clone(), rule.id)
        .await
        .unwrap());
    assert!(!store
        .delete_inhibition(tenant.clone(), rule.id)
        .await
        .unwrap());
    assert!(store.list_inhibitions(tenant).await.unwrap().is_empty());
}

#[tokio::test]
async fn list_firing_returns_only_firing_with_severity() {
    let store = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

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
    let rule = store.create_rule(tenant.clone(), &spec).await.unwrap();

    let mut labels = BTreeMap::new();
    labels.insert("instance".to_string(), "db1".to_string());
    let key = InstanceKey::new(rule.id, &labels);

    let mut firing =
        InstanceState::new_inactive(key.clone(), rule.id, tenant.clone(), labels.clone());
    firing.status = Status::Firing;
    firing.active_since = Some(OffsetDateTime::now_utc());
    store.upsert_instance(&firing).await.unwrap();

    let mut plabels = BTreeMap::new();
    plabels.insert("instance".to_string(), "db2".to_string());
    let pkey = InstanceKey::new(rule.id, &plabels);
    let mut pending = InstanceState::new_inactive(pkey, rule.id, tenant.clone(), plabels);
    pending.status = Status::Pending;
    store.upsert_instance(&pending).await.unwrap();

    let got = store.list_firing(tenant).await.unwrap();
    assert_eq!(got.len(), 1, "only the firing instance");
    assert_eq!(got[0].key, key);
    assert_eq!(
        got[0].severity,
        Severity::Critical,
        "severity comes from the rule"
    );
    assert_eq!(
        got[0].labels.get("instance").map(String::as_str),
        Some("db1")
    );
}
