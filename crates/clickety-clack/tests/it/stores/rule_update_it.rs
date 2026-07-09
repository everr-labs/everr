use cc::domain::ids::{RuleId, TenantId};
use cc::domain::rule::{RuleSpec, Severity};
use cc::stores::{PgStore, RuleUpdate};
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

async fn seed_instance(s: &PgStore, rule: RuleId, tenant: &TenantId, key: &str) {
    sqlx::query(
        "INSERT INTO instances (key, rule, tenant, status, labels, value, active_since, last_seen, absent_count)
         VALUES ($1, $2, $3, 'firing', '{\"host\":\"web-1\"}'::jsonb, 1.0, now(), now(), 0)",
    )
    .bind(key)
    .bind(rule.0)
    .bind(tenant.as_str())
    .execute(s.pool_for_test())
    .await
    .unwrap();
}

async fn instance_keys(s: &PgStore, rule: RuleId) -> Vec<String> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT key FROM instances WHERE rule=$1")
        .bind(rule.0)
        .fetch_all(s.pool_for_test())
        .await
        .unwrap();
    rows.into_iter().map(|(k,)| k).collect()
}

#[tokio::test]
async fn update_bumps_version_and_preserves_id_pause_and_instances() {
    let s = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = s.create_rule(tenant.clone(), &spec()).await.unwrap();
    assert_eq!(rule.version, 1);
    s.pause_rule(tenant.clone(), rule.id).await.unwrap();
    seed_instance(&s, rule.id, &tenant, "k1").await;

    // Same label_columns, changed threshold-ish SQL: instances must survive.
    let mut new_spec = spec();
    new_spec.sql = "SELECT host FROM t WHERE errors > 200".into();
    new_spec.severity = Severity::Critical;

    let out = s
        .update_rule(tenant.clone(), rule.id, &new_spec, None)
        .await
        .unwrap();
    let RuleUpdate::Updated(updated) = out else {
        panic!("expected Updated, got {out:?}");
    };
    assert_eq!(updated.id, rule.id, "rule id preserved");
    assert_eq!(updated.version, 2, "version bumped");
    assert!(updated.paused, "paused flag preserved");
    assert_eq!(updated.spec, new_spec);

    // Round-trip through the store agrees.
    let stored = s.get_rule(tenant.clone(), rule.id).await.unwrap().unwrap();
    assert_eq!(stored.version, 2);
    assert_eq!(stored.spec.sql, new_spec.sql);
    assert!(stored.paused);

    assert_eq!(
        instance_keys(&s, rule.id).await,
        vec!["k1".to_string()],
        "instance state preserved when label_columns are unchanged"
    );
}

#[tokio::test]
async fn update_version_guard() {
    let s = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = s.create_rule(tenant.clone(), &spec()).await.unwrap();

    // Wrong expected version: rejected, nothing written.
    let out = s
        .update_rule(tenant.clone(), rule.id, &spec(), Some(99))
        .await
        .unwrap();
    assert_eq!(out, RuleUpdate::VersionConflict { current: 1 });
    let stored = s.get_rule(tenant.clone(), rule.id).await.unwrap().unwrap();
    assert_eq!(stored.version, 1, "conflicting update must not write");

    // Matching expected version: accepted.
    let out = s
        .update_rule(tenant.clone(), rule.id, &spec(), Some(1))
        .await
        .unwrap();
    assert!(matches!(out, RuleUpdate::Updated(r) if r.version == 2));

    // Unknown rule / other tenant: NotFound.
    let out = s
        .update_rule(tenant.clone(), RuleId(Uuid::new_v4()), &spec(), None)
        .await
        .unwrap();
    assert_eq!(out, RuleUpdate::NotFound);
    let other = TenantId::from_trusted(Uuid::new_v4().to_string());
    let out = s.update_rule(other, rule.id, &spec(), None).await.unwrap();
    assert_eq!(out, RuleUpdate::NotFound);
}

#[tokio::test]
async fn label_columns_change_clears_instances_and_rollup() {
    let s = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = s.create_rule(tenant.clone(), &spec()).await.unwrap();
    seed_instance(&s, rule.id, &tenant, "k1").await;
    sqlx::query("UPDATE rules SET alert_state='firing', firing_instance_count=1, last_row_count=3 WHERE id=$1")
        .bind(rule.id.0)
        .execute(s.pool_for_test())
        .await
        .unwrap();

    // Reordering the same set is NOT an identity change: instances survive.
    let mut reordered = spec();
    reordered.label_columns = vec!["host".into()];
    let out = s
        .update_rule(tenant.clone(), rule.id, &reordered, None)
        .await
        .unwrap();
    assert!(matches!(out, RuleUpdate::Updated(_)));
    assert_eq!(instance_keys(&s, rule.id).await, vec!["k1".to_string()]);

    // A genuinely different label set orphans every existing key: cleared.
    let mut relabeled = spec();
    relabeled.label_columns = vec!["host".into(), "region".into()];
    let out = s
        .update_rule(tenant.clone(), rule.id, &relabeled, None)
        .await
        .unwrap();
    assert!(matches!(out, RuleUpdate::Updated(_)));
    assert!(
        instance_keys(&s, rule.id).await.is_empty(),
        "instances cleared when label_columns change"
    );
    let (state, firing, rows): (String, i32, i32) = sqlx::query_as(
        "SELECT alert_state, firing_instance_count, last_row_count FROM rules WHERE id=$1",
    )
    .bind(rule.id.0)
    .fetch_one(s.pool_for_test())
    .await
    .unwrap();
    assert_eq!(state, "inactive");
    assert_eq!(firing, 0);
    assert_eq!(rows, 0);
}

#[tokio::test]
async fn sql_change_resets_failure_counter_but_not_health_status() {
    let s = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = s.create_rule(tenant.clone(), &spec()).await.unwrap();
    sqlx::query(
        "UPDATE rules SET consecutive_failures=4, last_error='boom', last_error_at=now(),
                          health_status='degraded', degraded_since=now()
         WHERE id=$1",
    )
    .bind(rule.id.0)
    .execute(s.pool_for_test())
    .await
    .unwrap();

    // Unchanged SQL: counter untouched.
    let mut same_sql = spec();
    same_sql.for_secs = 60;
    s.update_rule(tenant.clone(), rule.id, &same_sql, None)
        .await
        .unwrap();
    let (failures,): (i32,) = sqlx::query_as("SELECT consecutive_failures FROM rules WHERE id=$1")
        .bind(rule.id.0)
        .fetch_one(s.pool_for_test())
        .await
        .unwrap();
    assert_eq!(failures, 4, "non-SQL edits keep the failure counter");

    // Changed SQL: counter and stored error reset; degraded status stays until a
    // successful eval flips it (so the RuleHealth Resolved event still fires).
    let mut new_sql = spec();
    new_sql.sql = "SELECT host FROM fixed_table".into();
    s.update_rule(tenant.clone(), rule.id, &new_sql, None)
        .await
        .unwrap();
    let (failures, last_error, status): (i32, Option<String>, String) = sqlx::query_as(
        "SELECT consecutive_failures, last_error, health_status FROM rules WHERE id=$1",
    )
    .bind(rule.id.0)
    .fetch_one(s.pool_for_test())
    .await
    .unwrap();
    assert_eq!(failures, 0);
    assert_eq!(last_error, None);
    assert_eq!(status, "degraded", "recovery is event-paired, not silent");
}

#[tokio::test]
async fn interval_change_pulls_next_eval_forward() {
    let s = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = s.create_rule(tenant.clone(), &spec()).await.unwrap();
    // Simulate a slow rule mid-cycle: next eval an hour out.
    sqlx::query("UPDATE rules SET next_eval = now() + interval '1 hour' WHERE id=$1")
        .bind(rule.id.0)
        .execute(s.pool_for_test())
        .await
        .unwrap();

    let mut fast = spec();
    fast.interval_secs = 10;
    s.update_rule(tenant.clone(), rule.id, &fast, None)
        .await
        .unwrap();

    let (secs_until,): (f64,) = sqlx::query_as(
        "SELECT EXTRACT(EPOCH FROM (next_eval - now()))::float8 FROM rules WHERE id=$1",
    )
    .bind(rule.id.0)
    .fetch_one(s.pool_for_test())
    .await
    .unwrap();
    assert!(
        secs_until <= 10.5,
        "next_eval must land within one new interval, got {secs_until}s"
    );
    // The pull-forward re-arms at the rule's jitter phase in [0, new_interval),
    // so a phase of 0 legitimately makes the rule due immediately; it must just
    // never be pushed meaningfully into the past.
    assert!(
        secs_until > -1.0,
        "next_eval should not be forced into the past, got {secs_until}s"
    );
}
