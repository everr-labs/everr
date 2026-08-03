use crate::support::create_test_rule;
use cc::domain::ids::{RuleId, TenantId};
use cc::domain::rule::{RuleSpec, Severity};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use uuid::Uuid;

async fn store() -> PgStore {
    let url = crate::support::fresh_db().await;
    let s = PgStore::connect(&url).await.unwrap();
    s
}

fn spec() -> RuleSpec {
    RuleSpec {
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
    }
}

#[tokio::test]
async fn pause_and_resume_toggle_flag() {
    let s = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &s,
        tenant.clone(),
        "t/pause_and_resume_toggle_flag",
        &spec(),
    )
    .await;
    assert!(!rule.paused);

    assert!(s.pause_rule(tenant.clone(), rule.id).await.unwrap());
    assert!(
        s.get_rule(tenant.clone(), rule.id)
            .await
            .unwrap()
            .unwrap()
            .paused
    );

    // Idempotent: pausing again still succeeds.
    assert!(s.pause_rule(tenant.clone(), rule.id).await.unwrap());

    assert!(s.resume_rule(tenant.clone(), rule.id).await.unwrap());
    assert!(!s.get_rule(tenant, rule.id).await.unwrap().unwrap().paused);
}

#[tokio::test]
async fn pause_missing_or_wrong_tenant_returns_false() {
    let s = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &s,
        tenant.clone(),
        "t/pause_missing_or_wrong_tenant_returns_false",
        &spec(),
    )
    .await;

    assert!(!s
        .pause_rule(tenant.clone(), RuleId(Uuid::new_v4()))
        .await
        .unwrap());
    assert!(!s
        .pause_rule(TenantId::from_trusted(Uuid::new_v4().to_string()), rule.id)
        .await
        .unwrap());
    assert!(!s.resume_rule(tenant, RuleId(Uuid::new_v4())).await.unwrap());
}

#[tokio::test]
async fn resume_resets_pending_instances() {
    let s = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &s,
        tenant.clone(),
        "t/resume_resets_pending_instances",
        &spec(),
    )
    .await;

    // Insert a pending instance with a stale active_since and a nonzero absent_count.
    sqlx::query(
        "INSERT INTO instances (key, rule, tenant, status, labels, value, active_since, last_seen, absent_count)
         VALUES ('k1', $1, $2, 'pending', '{}'::jsonb, NULL, now() - interval '1 hour', now() - interval '1 hour', 2)",
    )
    .bind(rule.id.0)
    .bind(tenant.as_str())
    .execute(s.pool_for_test())
    .await
    .unwrap();

    s.pause_rule(tenant.clone(), rule.id).await.unwrap();
    s.resume_rule(tenant, rule.id).await.unwrap();

    let (active_since, absent): (Option<time::OffsetDateTime>, i32) =
        sqlx::query_as("SELECT active_since, absent_count FROM instances WHERE key='k1'")
            .fetch_one(s.pool_for_test())
            .await
            .unwrap();
    assert!(active_since.is_none(), "for-duration clock was reset");
    assert_eq!(absent, 0, "absent_count was reset");
}

#[tokio::test]
async fn paused_rules_are_not_claimed() {
    let s = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let active = create_test_rule(
        &s,
        tenant.clone(),
        "t/paused_rules_are_not_claimed-active",
        &spec(),
    )
    .await;
    let paused = create_test_rule(
        &s,
        tenant.clone(),
        "t/paused_rules_are_not_claimed-paused",
        &spec(),
    )
    .await;
    s.pause_rule(tenant.clone(), paused.id).await.unwrap();

    // Past one full interval (create_rule arms next_eval at the rule's jitter
    // phase in [0, 30s)) plus skew slack; matches the idiom in sharding_it.rs.
    let now = time::OffsetDateTime::now_utc() + time::Duration::seconds(35);

    // Non-sharded claim: only the active rule is returned.
    let claimed = s.claim_due_rules(now, 100).await.unwrap();
    let ids: Vec<_> = claimed.iter().map(|r| r.id).collect();
    assert!(ids.contains(&active.id));
    assert!(!ids.contains(&paused.id), "paused rule must not be claimed");

    // Reset next_eval so the sharded claim sees both as due again.
    sqlx::query("UPDATE rules SET next_eval = now() WHERE tenant=$1")
        .bind(tenant.as_str())
        .execute(s.pool_for_test())
        .await
        .unwrap();

    // Sharded claim with shard_count=1, owned=[0] owns every tenant.
    let claimed = s.claim_due_rules_sharded(now, 100, &[0], 1).await.unwrap();
    let ids: Vec<_> = claimed.iter().map(|r| r.id).collect();
    assert!(ids.contains(&active.id));
    assert!(
        !ids.contains(&paused.id),
        "paused rule must not be claimed (sharded)"
    );
}

#[tokio::test]
async fn paused_rules_firing_instances_are_not_reconciled() {
    let s = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &s,
        tenant.clone(),
        "t/paused_rules_firing_instances_are_not_reconciled",
        &spec(),
    )
    .await; // interval_secs=30 -> stale after 60s

    // A firing instance last seen an hour ago is stale by the max(4*interval,60s) rule.
    sqlx::query(
        "INSERT INTO instances (key, rule, tenant, status, labels, value, active_since, last_seen, absent_count)
         VALUES ('stale1', $1, $2, 'firing', '{}'::jsonb, NULL, now() - interval '2 hours', now() - interval '1 hour', 0)",
    )
    .bind(rule.id.0)
    .bind(tenant.as_str())
    .execute(s.pool_for_test())
    .await
    .unwrap();

    let now = time::OffsetDateTime::now_utc();

    // Active rule: the stale firing instance is reconcilable.
    let stale = s.list_stale_instances(now, 1000).await.unwrap();
    assert!(stale.iter().any(|i| i.key.0 == "stale1"));

    // Pause the rule: it must drop out of the reconciliation set, so the
    // maintenance sweep cannot synthesize a (misleading) Resolved.
    s.pause_rule(tenant, rule.id).await.unwrap();
    let stale = s.list_stale_instances(now, 1000).await.unwrap();
    assert!(
        !stale.iter().any(|i| i.key.0 == "stale1"),
        "paused rule's firing instance must NOT be auto-resolved"
    );
}
