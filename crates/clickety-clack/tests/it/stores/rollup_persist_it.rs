use cc::domain::ids::{InstanceKey, SourceId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::rollup::{AlertState, RuleRollup};
use cc::domain::rule::{RuleSpec, Severity};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use time::OffsetDateTime;
use uuid::Uuid;

async fn store() -> (PgStore, impl Sized) {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    (store, ())
}

#[tokio::test]
async fn rollup_written_in_same_tx_and_advances() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let spec = RuleSpec {
        sql: "SELECT host FROM t".into(),
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec!["host".into()],
        value_column: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    };
    let rule = store.create_rule(tenant.clone(), &spec).await.unwrap();

    let labels = BTreeMap::from([("host".to_string(), "a".to_string())]);
    let key = InstanceKey::new(rule.id, &labels);
    let mut inst =
        InstanceState::new_inactive(key.clone(), SourceId::Rule(rule.id), tenant.clone(), labels);
    inst.status = Status::Firing;
    inst.last_seen = Some(OffsetDateTime::UNIX_EPOCH);

    let now = OffsetDateTime::from_unix_timestamp(1_000).unwrap();
    let rollup = RuleRollup {
        state: AlertState::Firing,
        firing_instance_count: 1,
        fired_at: Some(now),
        resolved_at: None,
        seen_at: Some(now),
        row_count: 1,
    };
    store
        .persist_eval_batch(
            std::slice::from_ref(&inst),
            &[],
            Some((rule.id, rollup)),
            None,
            Some(&tenant),
        )
        .await
        .unwrap();

    let (_r, _h, _rollup, _updated_at) = store
        .get_rule_with_health(tenant.clone(), rule.id)
        .await
        .unwrap()
        .unwrap();
    // Read raw columns to assert the write (get_rule_with_health surfaces them after Task 1.5).
    let row = sqlx::query_scalar::<_, String>("SELECT alert_state FROM rules WHERE id=$1")
        .bind(rule.id.0)
        .fetch_one(store.pool_for_test())
        .await
        .unwrap();
    assert_eq!(row, "firing");
    let fic: i32 = sqlx::query_scalar("SELECT firing_instance_count FROM rules WHERE id=$1")
        .bind(rule.id.0)
        .fetch_one(store.pool_for_test())
        .await
        .unwrap();
    assert_eq!(fic, 1);

    // A later eval with no transition (None timestamps) must NOT clear last_fired_at.
    let rollup2 = RuleRollup {
        state: AlertState::Firing,
        firing_instance_count: 1,
        fired_at: None,
        resolved_at: None,
        seen_at: Some(now),
        row_count: 1,
    };
    store
        .persist_eval_batch(&[], &[], Some((rule.id, rollup2)), None, Some(&tenant))
        .await
        .unwrap();
    let lfa: Option<OffsetDateTime> =
        sqlx::query_scalar("SELECT last_fired_at FROM rules WHERE id=$1")
            .bind(rule.id.0)
            .fetch_one(store.pool_for_test())
            .await
            .unwrap();
    assert!(lfa.is_some(), "COALESCE preserved last_fired_at");
}
