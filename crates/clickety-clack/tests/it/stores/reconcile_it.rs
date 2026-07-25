use crate::support::create_test_rule;
use cc::domain::ids::{InstanceKey, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::{RuleSpec, Severity};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

fn spec_interval(interval_secs: u32) -> RuleSpec {
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

async fn store() -> (PgStore, impl Sized) {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    (store, ())
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
async fn stale_query_uses_per_rule_interval() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/stale_query_uses_per_rule_interval-fast",
        &spec_interval(30),
    )
    .await; // threshold max(120,60)=120s
    let slow = create_test_rule(
        &store,
        tenant.clone(),
        "t/stale_query_uses_per_rule_interval-slow",
        &spec_interval(120),
    )
    .await; // threshold max(480,60)=480s
    let now = OffsetDateTime::now_utc();

    store
        .upsert_instance(&instance(
            rule.id,
            tenant.clone(),
            "fresh",
            Status::Firing,
            now - Duration::seconds(10),
        ))
        .await
        .unwrap();
    store
        .upsert_instance(&instance(
            rule.id,
            tenant.clone(),
            "old-fire",
            Status::Firing,
            now - Duration::seconds(300),
        ))
        .await
        .unwrap();
    store
        .upsert_instance(&instance(
            rule.id,
            tenant.clone(),
            "old-pend",
            Status::Pending,
            now - Duration::seconds(300),
        ))
        .await
        .unwrap();
    store
        .upsert_instance(&instance(
            rule.id,
            tenant.clone(),
            "old-inact",
            Status::Inactive,
            now - Duration::seconds(300),
        ))
        .await
        .unwrap();
    // Under the slow rule (480s threshold), 300s is NOT stale → must be EXCLUDED.
    store
        .upsert_instance(&instance(
            slow.id,
            tenant,
            "slow-fresh",
            Status::Firing,
            now - Duration::seconds(300),
        ))
        .await
        .unwrap();

    let stale = store.list_stale_instances(now, 1000).await.unwrap();
    let names: std::collections::BTreeSet<String> = stale
        .iter()
        .map(|s| s.labels.get("service").cloned().unwrap())
        .collect();
    assert_eq!(
        names,
        ["old-fire".to_string(), "old-pend".to_string()]
            .into_iter()
            .collect()
    );
    assert!(stale.iter().all(|s| s.severity == Severity::Critical));
}

#[tokio::test]
async fn gc_silences_deletes_only_expired_before_cutoff() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let now = OffsetDateTime::now_utc();
    let m = vec![Matcher {
        label: "service".to_string(),
        op: MatchOp::Eq,
        value: "api".to_string(),
    }];

    store
        .create_silence(
            tenant.clone(),
            &m,
            now - Duration::days(3),
            now - Duration::days(2),
            "old",
            "t",
        )
        .await
        .unwrap();
    store
        .create_silence(
            tenant.clone(),
            &m,
            now - Duration::hours(1),
            now + Duration::hours(1),
            "active",
            "t",
        )
        .await
        .unwrap();

    let cutoff = now - Duration::days(1);
    let deleted = store.gc_silences(cutoff).await.unwrap();
    assert_eq!(deleted, 1, "only the long-expired silence is removed");

    let active = store.list_active_silences(tenant, now).await.unwrap();
    assert_eq!(active.len(), 1);
}

/// The delivery ledger grows on every send and nothing else ever removes a row, so the
/// hourly prune is the only thing bounding it. Rows are selected by `updated_at`, which
/// the claim protocol touches on each state change, so a row stays for its retention
/// past its LAST activity rather than its creation.
#[tokio::test]
async fn prune_notifications_deletes_only_rows_untouched_before_cutoff() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let now = OffsetDateTime::now_utc();

    // Three rows, aged by writing `updated_at` directly (the column defaults to now()).
    for (key, status, age_hours) in [
        ("old-sent", "sent", 48),
        ("old-pending", "pending", 48),
        ("recent-sent", "sent", 1),
    ] {
        sqlx::query(
            "INSERT INTO notifications (dedup_key, tenant, channel, target, status, updated_at)
             VALUES ($1,$2,'webhook','http://x/h',$3,$4)",
        )
        .bind(key)
        .bind(tenant.as_str())
        .bind(status)
        .bind(now - Duration::hours(age_hours))
        .execute(&pool)
        .await
        .unwrap();
    }

    let deleted = store
        .prune_notifications(now - Duration::hours(24))
        .await
        .unwrap();
    assert_eq!(deleted, 2, "both aged rows go, whatever their status");

    let left: Vec<String> = sqlx::query_scalar(
        "SELECT dedup_key FROM notifications WHERE tenant=$1 ORDER BY dedup_key",
    )
    .bind(tenant.as_str())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        left,
        vec!["recent-sent".to_string()],
        "a row touched inside the window survives"
    );

    // Idempotent: a second pass over the same cutoff removes nothing more.
    assert_eq!(
        store
            .prune_notifications(now - Duration::hours(24))
            .await
            .unwrap(),
        0
    );
}
