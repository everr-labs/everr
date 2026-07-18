//! Task 11: the SLO stale reaper (mirrors `maintenance_it.rs`'s rule-side reconcile
//! sweep, against `slo_instances`) and the maintenance-driven eval-ledger prune.

use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::rule::{RuleSpec, Severity};
use cc::domain::slo::{SliSpec, SloSpec, TimeWindow};
use cc::domain::EventStatus;
use cc::evaluator::maintenance::{reconcile_slo_once, run_maintenance};
use cc::queue::event_bus::RedisEventBus;
use cc::queue::EventBus;
use cc::stores::{PgStore, RedisLease, SloCreate};
use std::collections::BTreeMap;
use std::time::Duration as StdDuration;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

fn tenant() -> TenantId {
    TenantId::from_trusted(Uuid::new_v4().to_string())
}

fn slo_spec() -> SloSpec {
    SloSpec {
        sli: SliSpec {
            sql: "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}".into(),
            label_columns: vec![],
        },
        target_percent: 99.9,
        time_window: TimeWindow {
            duration: "30d".into(),
            is_rolling: true,
            calendar: None,
        },
        min_valid_events: None,
        tiers: None,
        annotations: BTreeMap::new(),
        suppressed: false,
    }
}

fn rule_spec() -> RuleSpec {
    RuleSpec {
        sql: "SELECT 1".into(),
        interval_secs: 30,
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

/// Builds an SLO instance row directly (bypassing the firing pipeline), keyed on the
/// SLO's uuid the way `InstanceState.rule` carries it for `slo_instances` rows. `group`
/// distinguishes rows within the same SLO (mirrors a group label) so two instances of
/// the same SLO don't collide on `InstanceKey`.
fn slo_instance(
    slo_rule: RuleId,
    tenant: TenantId,
    group: &str,
    status: Status,
    last_seen: OffsetDateTime,
) -> InstanceState {
    let labels = BTreeMap::from([
        ("slo_tier".to_string(), "fast-burn".to_string()),
        ("group".to_string(), group.to_string()),
    ]);
    let key = InstanceKey::new(slo_rule, &labels);
    let mut s = InstanceState::new_inactive(key, slo_rule, tenant, labels);
    s.status = status;
    s.value = Some(20.0);
    s.active_since = Some(last_seen);
    s.last_seen = Some(last_seen);
    s
}

/// The reaper mechanism itself: a stale firing SLO instance (last_seen 10min ago,
/// cadence 30s => staleness threshold max(4*30,60)=120s) resets to Inactive and
/// publishes a Resolved event stamped with `slo`; a fresh instance is left alone.
#[tokio::test]
async fn reaper_resolves_stale_slo_instance_and_leaves_fresh_untouched() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus = RedisEventBus::connect(&redis_url).await.unwrap();

    let t = tenant();
    let SloCreate::Created(slo) = store
        .create_slo(t.clone(), "checkout", &slo_spec())
        .await
        .unwrap()
    else {
        panic!("slo creation must succeed against a fresh tenant")
    };
    let slo_rule = RuleId(slo.id.0);
    let now = OffsetDateTime::now_utc();

    let stale = slo_instance(
        slo_rule,
        t.clone(),
        "stale",
        Status::Firing,
        now - Duration::minutes(10),
    );
    let fresh = slo_instance(slo_rule, t.clone(), "fresh", Status::Firing, now);
    store
        .persist_slo_eval_batch(&[stale.clone(), fresh.clone()], &[])
        .await
        .unwrap();

    let n = reconcile_slo_once(&store, &bus, now, 30).await.unwrap();
    assert_eq!(n, 1, "exactly one stale SLO instance reconciled");

    let loaded = store.load_slo_instances(&t, slo.id).await.unwrap();
    let by_key = |key: &InstanceKey| loaded.iter().find(|i| &i.key == key).unwrap().status;
    assert_eq!(by_key(&stale.key), Status::Inactive, "stale instance reset");
    assert_eq!(
        by_key(&fresh.key),
        Status::Firing,
        "fresh instance untouched"
    );

    let got = bus.consume("slo-reaper-test", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1, "one Resolved event for the stale instance");
    let ev = &got[0].event;
    assert_eq!(ev.status, EventStatus::Resolved);
    assert_eq!(ev.slo, Some(slo.id), "synthesized event stamps slo");
    assert_eq!(ev.instance_key, stale.key);

    let remaining = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 256)
        .await
        .unwrap();
    assert!(remaining.is_empty(), "outbox drained after the sweep");
}

/// The full `run_maintenance` loop (not just the pure sweep functions): its first
/// tick always runs the GC/prune branch (`last_gc` starts `None`), so one tick proves
/// both the SLO reaper and the eval-ledger prune are wired end-to-end. Old rows in
/// BOTH `evaluations` and `slo_evaluations` are pruned; recent rows are kept.
#[tokio::test]
async fn maintenance_loop_reaps_slo_and_prunes_ledgers() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: std::sync::Arc<dyn EventBus> =
        std::sync::Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());

    let t = tenant();
    let SloCreate::Created(slo) = store
        .create_slo(t.clone(), "checkout", &slo_spec())
        .await
        .unwrap()
    else {
        panic!("slo creation must succeed against a fresh tenant")
    };
    let slo_rule = RuleId(slo.id.0);
    let rule = store.create_rule(t.clone(), &rule_spec()).await.unwrap();
    let now = OffsetDateTime::now_utc();

    // A stale firing SLO instance for the reaper pass.
    let stale = slo_instance(
        slo_rule,
        t.clone(),
        "stale",
        Status::Firing,
        now - Duration::minutes(10),
    );
    store
        .persist_slo_eval_batch(std::slice::from_ref(&stale), &[])
        .await
        .unwrap();

    // Old + recent ledger rows on both the rule and SLO side. `LEDGER_RETENTION` is 7
    // days, so the "old" pair must be well past that (the maintenance loop's own
    // cutoff, not a caller-supplied one — unlike the direct `prune_eval_ledgers` unit
    // test in `slo_alert_store_it.rs`).
    let old_ts = now - Duration::days(8);
    assert!(store.try_claim_eval(rule.id, old_ts).await.unwrap());
    assert!(store.try_claim_eval(rule.id, now).await.unwrap());
    assert!(store.try_claim_slo_eval(slo.id, old_ts).await.unwrap());
    assert!(store.try_claim_slo_eval(slo.id, now).await.unwrap());

    let lease = RedisLease::connect(&redis_url, "cc:maintenance:lease", "m1", 10_000)
        .await
        .unwrap();
    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let handle = {
        let store = store.clone();
        let bus = bus.clone();
        tokio::spawn(async move {
            run_maintenance(
                store,
                bus,
                lease,
                StdDuration::from_millis(100),
                30,
                cc::otel::EngineMetrics::disabled(),
                sd_rx,
            )
            .await;
        })
    };

    // Give the loop a few ticks to acquire the lease and run at least once (its
    // first pass always runs the GC/prune branch since `last_gc` starts `None`).
    tokio::time::sleep(StdDuration::from_secs(2)).await;
    let _ = sd_tx.send(true);
    handle.await.unwrap();

    // ---- Reaper assertions ----
    let loaded = store.load_slo_instances(&t, slo.id).await.unwrap();
    let got_stale = loaded.iter().find(|i| i.key == stale.key).unwrap();
    assert_eq!(
        got_stale.status,
        Status::Inactive,
        "maintenance loop reaped the stale SLO instance"
    );

    let events = bus.consume("slo-reaper-loop-test", 10, 1000).await.unwrap();
    assert!(
        events
            .iter()
            .any(|e| e.event.status == EventStatus::Resolved && e.event.slo == Some(slo.id)),
        "maintenance loop published the SLO's Resolved event: {events:?}"
    );

    // ---- Prune assertions: the old (rule, old_ts) and (slo, old_ts) pairs are free
    // to be reclaimed again (row deleted); the recent pairs are still present (still
    // conflict, so reclaiming returns false).
    assert!(
        store.try_claim_eval(rule.id, old_ts).await.unwrap(),
        "old evaluations row must have been pruned"
    );
    assert!(
        !store.try_claim_eval(rule.id, now).await.unwrap(),
        "recent evaluations row must be kept"
    );
    assert!(
        store.try_claim_slo_eval(slo.id, old_ts).await.unwrap(),
        "old slo_evaluations row must have been pruned"
    );
    assert!(
        !store.try_claim_slo_eval(slo.id, now).await.unwrap(),
        "recent slo_evaluations row must be kept"
    );
}
