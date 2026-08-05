use crate::support::create_test_slo;
use async_trait::async_trait;
use cc::domain::ids::TenantId;
use cc::domain::slo::{SliSpec, SloSpec, TimeWindow};
use cc::engine::slo_math::{SloStatusPayload, SloTierStatus};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use time::OffsetDateTime;

// These tests only assert on the `slo_status` snapshot, not on published events
// (that's `slo_alerting_it.rs`'s job), so the shared no-op bus suffices.
use crate::common::NoopBus;

/// A stub querier that returns fixed good/valid regardless of params/window, and
/// counts how many times it was called (used by the freshness/merge test).
struct StubCh {
    good: f64,
    valid: f64,
    calls: AtomicUsize,
}

#[async_trait]
impl cc::clickhouse::RowQuerier for StubCh {
    async fn query_rows_params(
        &self,
        _t: &TenantId,
        _sql: &str,
        _p: &[(String, String)],
        _lc: &[String],
        _vc: Option<&str>,
    ) -> Result<Vec<cc::clickhouse::ResultRow>, cc::clickhouse::ChError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(vec![cc::clickhouse::ResultRow {
            labels: BTreeMap::new(),
            value: Some(self.valid),
            extra: BTreeMap::from([("good".into(), serde_json::json!(self.good))]),
        }])
    }
    fn auth_identity(&self, t: &TenantId) -> cc::clickhouse::AuthIdentity {
        cc::clickhouse::AuthIdentity {
            user: t.as_str().to_string(),
        }
    }
}

struct ErrCh;

#[async_trait]
impl cc::clickhouse::RowQuerier for ErrCh {
    async fn query_rows_params(
        &self,
        _t: &TenantId,
        _s: &str,
        _p: &[(String, String)],
        _lc: &[String],
        _vc: Option<&str>,
    ) -> Result<Vec<cc::clickhouse::ResultRow>, cc::clickhouse::ChError> {
        Err(cc::clickhouse::ChError::Http("boom".into()))
    }
    fn auth_identity(&self, t: &TenantId) -> cc::clickhouse::AuthIdentity {
        cc::clickhouse::AuthIdentity {
            user: t.as_str().to_string(),
        }
    }
}

struct MultiRowCh;

#[async_trait]
impl cc::clickhouse::RowQuerier for MultiRowCh {
    async fn query_rows_params(
        &self,
        _t: &TenantId,
        _s: &str,
        _p: &[(String, String)],
        _lc: &[String],
        _vc: Option<&str>,
    ) -> Result<Vec<cc::clickhouse::ResultRow>, cc::clickhouse::ChError> {
        let row = || cc::clickhouse::ResultRow {
            labels: BTreeMap::new(),
            value: Some(100.0),
            extra: BTreeMap::from([("good".into(), serde_json::json!(99.0))]),
        };
        Ok(vec![row(), row()])
    }

    fn auth_identity(&self, t: &TenantId) -> cc::clickhouse::AuthIdentity {
        cc::clickhouse::AuthIdentity {
            user: t.as_str().to_string(),
        }
    }
}

fn spec() -> SloSpec {
    SloSpec {
        sli: SliSpec {
            sql: "SELECT countIf(ok) AS good, count() AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}".into(),
        },
        target_percent: 99.9,
        time_window: TimeWindow {
            duration: "30d".into(),
            is_rolling: true,
            calendar: None,
        },
        min_valid_events: None,
        annotations: BTreeMap::new(),
        suppressed: false,
    }
}

#[tokio::test]
async fn evaluate_writes_budget_snapshot() {
    let store = PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap();
    let tenant = TenantId::from_trusted("t1");
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/evaluate_writes_budget_snapshot",
        &spec(),
    )
    .await;
    // 98.56% good -> budget over-consumed; burn rate 14.4x
    let ch = StubCh {
        good: 9856.0,
        valid: 10000.0,
        calls: AtomicUsize::new(0),
    };
    cc::evaluator::slo::evaluate_slo(
        &store,
        &ch,
        &NoopBus,
        &cc::domain::NullSink,
        &slo,
        OffsetDateTime::now_utc(),
        30,
        3,
        0,
    )
    .await
    .unwrap();

    let snap = store
        .get_slo_status(&tenant, slo.id)
        .await
        .unwrap()
        .unwrap();
    let br = snap.payload["tiers"][0]["long_burn_rate"].as_f64().unwrap();
    assert!((br - 14.4).abs() < 1e-3, "got {br}");
    assert!(snap.payload["budget_remaining"].as_f64().unwrap() < 0.0);
}

#[tokio::test]
async fn query_error_degrades_and_does_not_write_snapshot() {
    let store = PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap();
    let tenant = TenantId::from_trusted("t2");
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/query_error_degrades_and_does_not_write_snapshot",
        &spec(),
    )
    .await;
    cc::evaluator::slo::evaluate_slo(
        &store,
        &ErrCh,
        &NoopBus,
        &cc::domain::NullSink,
        &slo,
        OffsetDateTime::now_utc(),
        30,
        1,
        0,
    )
    .await
    .unwrap();
    // no snapshot written (freeze on error)
    assert!(store
        .get_slo_status(&tenant, slo.id)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn multiple_rows_degrade_and_do_not_write_snapshot() {
    let store = PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap();
    let tenant = TenantId::from_trusted("multi-row");
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/multiple_rows_degrade_and_do_not_write_snapshot",
        &spec(),
    )
    .await;

    cc::evaluator::slo::evaluate_slo(
        &store,
        &MultiRowCh,
        &NoopBus,
        &cc::domain::NullSink,
        &slo,
        OffsetDateTime::now_utc(),
        30,
        1,
        0,
    )
    .await
    .unwrap();

    assert!(store
        .get_slo_status(&tenant, slo.id)
        .await
        .unwrap()
        .is_none());
    let health = store
        .get_slo_health(&tenant, slo.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(health.status, "degraded");
    assert_eq!(
        health.last_error.as_deref(),
        Some("SLI query must return at most one row")
    );
}

/// Freshness/merge integration: seed a prior snapshot whose long/budget windows were
/// "just computed", leaving only the short windows due. Asserts (a) the querier is
/// only called for the due short windows (fresh long/budget windows are skipped), and
/// (b) the resulting snapshot still carries the prior budget window's
/// `window_computed_at` and its long-burn-rate values unchanged.
#[tokio::test]
async fn fresh_windows_are_not_requeried() {
    let store = PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap();
    let tenant = TenantId::from_trusted("t3");
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/fresh_windows_are_not_requeried",
        &spec(),
    )
    .await;

    // Canonical tiers over a 30d budget window require windows at:
    // 300s (fast-burn short), 1800s (slow-burn short), 3600s (fast-burn long),
    // 21600s (slow-burn long AND ticket short), 259200s (ticket long),
    // 2592000s (budget window).
    // Mark every window EXCEPT the two "pure short" windows (300s, 1800s) as
    // just-computed, so only those two remain due this tick.
    let seed_ts = OffsetDateTime::now_utc();
    let prior = SloStatusPayload {
        window: "30d".into(),
        target_percent: 99.9,
        sli: Some(0.999),
        budget_remaining: Some(0.5),
        tiers: vec![
            SloTierStatus {
                name: "fast-burn".into(),
                long_burn_rate: Some(1.0),
                short_burn_rate: Some(2.0),
                long_window_valid: None,
            },
            SloTierStatus {
                name: "slow-burn".into(),
                long_burn_rate: Some(3.0),
                short_burn_rate: Some(4.0),
                long_window_valid: None,
            },
            SloTierStatus {
                name: "ticket".into(),
                long_burn_rate: Some(5.0),
                short_burn_rate: Some(6.0),
                long_window_valid: None,
            },
        ],
        window_computed_at: BTreeMap::from([
            ("3600s".into(), seed_ts.unix_timestamp()),
            ("21600s".into(), seed_ts.unix_timestamp()),
            ("259200s".into(), seed_ts.unix_timestamp()),
            ("2592000s".into(), seed_ts.unix_timestamp()),
        ]),
        // Stamp the CURRENT objective so the evaluator treats this seeded snapshot
        // as its own and carries it forward — the point of this freshness test. A
        // missing/mismatched fingerprint would make it discard the snapshot and
        // recompute every window, defeating the "only 300s/1800s are due" setup.
        objective_fingerprint: Some(cc::domain::slo::objective_fingerprint(&spec())),
    };
    store
        .upsert_slo_status(
            slo.id,
            &tenant,
            &serde_json::to_value(&prior).unwrap(),
            seed_ts,
        )
        .await
        .unwrap();

    // Advance the clock by 60s: well under every seeded window's refresh cadence
    // (the smallest is 3600s/12 = 300s), so none of the seeded windows come due;
    // the two never-seen windows (300s, 1800s) are always due regardless.
    let eval_ts = seed_ts + time::Duration::seconds(60);
    let ch = StubCh {
        good: 50.0,
        valid: 100.0,
        calls: AtomicUsize::new(0),
    };
    cc::evaluator::slo::evaluate_slo(
        &store,
        &ch,
        &NoopBus,
        &cc::domain::NullSink,
        &slo,
        eval_ts,
        60,
        3,
        0,
    )
    .await
    .unwrap();

    let snap = store
        .get_slo_status(&tenant, slo.id)
        .await
        .unwrap()
        .unwrap();
    let payload: SloStatusPayload = serde_json::from_value(snap.payload).unwrap();
    assert_eq!(
        payload.window_computed_at["2592000s"],
        seed_ts.unix_timestamp(),
        "fresh budget window must not be requeried (its computed_at is unchanged)"
    );
    assert_eq!(
        payload.window_computed_at["3600s"],
        seed_ts.unix_timestamp(),
        "fresh fast-burn long window must not be requeried"
    );
    // due short windows advanced to this tick's eval_ts
    assert_eq!(payload.window_computed_at["300s"], eval_ts.unix_timestamp());
    assert_eq!(
        payload.window_computed_at["1800s"],
        eval_ts.unix_timestamp()
    );

    // budget window (2592000s) was not due -> sli/budget_remaining carried from prior
    assert_eq!(payload.sli, Some(0.999));
    assert_eq!(payload.budget_remaining, Some(0.5));

    let fast = payload
        .tiers
        .iter()
        .find(|t| t.name == "fast-burn")
        .unwrap();
    assert_eq!(
        fast.long_burn_rate,
        Some(1.0),
        "long burn rate carried from prior snapshot (its window was not due)"
    );
    assert_ne!(
        fast.short_burn_rate,
        Some(2.0),
        "short burn rate must be recomputed this tick (its window was due)"
    );

    let slow = payload
        .tiers
        .iter()
        .find(|t| t.name == "slow-burn")
        .unwrap();
    assert_eq!(
        slow.long_burn_rate,
        Some(3.0),
        "slow-burn long burn rate carried (21600s not due)"
    );

    let ticket = payload.tiers.iter().find(|t| t.name == "ticket").unwrap();
    assert_eq!(
        ticket.long_burn_rate,
        Some(5.0),
        "ticket long burn rate carried (259200s not due)"
    );
    assert_eq!(
        ticket.short_burn_rate,
        Some(6.0),
        "ticket short burn rate carried too (its window, 21600s, coincides with \
         slow-burn's long window and was seeded as just-computed)"
    );
}

/// A prior snapshot's freshness ledger may hold windows that are not in the SLO's
/// current tier set (a tier window changed without the objective fingerprint
/// moving, so the snapshot is carried rather than discarded). The evaluator must
/// rebuild the ledger from the CURRENT required windows, dropping the orphaned keys
/// instead of letting them linger.
#[tokio::test]
async fn stale_ledger_windows_are_pruned_to_the_current_tier_set() {
    let store = PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap();
    let tenant = TenantId::from_trusted("t_prune");
    let mut spec_7d = spec();
    spec_7d.time_window.duration = "7d".into();
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/stale_ledger_windows_are_pruned_to_the_current_tier_set",
        &spec_7d,
    )
    .await;

    // The 7-day scaled tier windows the evaluator will actually require, each
    // seeded as just-computed, PLUS two orphans from the canonical 30-day table
    // (3600s = 1h fast-burn long, 259200s = 3d ticket long) that a 7-day SLO does
    // not use. The huge base cadence keeps every seeded window fresh, so nothing is
    // requeried and the only change is the ledger rebuild.
    let seed_ts = OffsetDateTime::now_utc();
    let seven_day_windows = ["70s", "420s", "840s", "5040s", "60480s", "604800s"];
    let mut ledger: BTreeMap<String, i64> = seven_day_windows
        .iter()
        .map(|w| ((*w).to_string(), seed_ts.unix_timestamp()))
        .collect();
    ledger.insert("3600s".into(), seed_ts.unix_timestamp()); // orphan
    ledger.insert("259200s".into(), seed_ts.unix_timestamp()); // orphan
    let prior = SloStatusPayload {
        window: "7d".into(),
        target_percent: 99.9,
        sli: Some(0.999),
        budget_remaining: Some(0.5),
        tiers: vec![],
        window_computed_at: ledger,
        objective_fingerprint: Some(cc::domain::slo::objective_fingerprint(&spec_7d)),
    };
    store
        .upsert_slo_status(
            slo.id,
            &tenant,
            &serde_json::to_value(&prior).unwrap(),
            seed_ts,
        )
        .await
        .unwrap();

    let ch = StubCh {
        good: 50.0,
        valid: 100.0,
        calls: AtomicUsize::new(0),
    };
    // Advance 60s with a base cadence far larger than any window's refresh, so no
    // seeded window comes due (the ledger is purely carried, then pruned).
    cc::evaluator::slo::evaluate_slo(
        &store,
        &ch,
        &NoopBus,
        &cc::domain::NullSink,
        &slo,
        seed_ts + time::Duration::seconds(60),
        10_000_000,
        3,
        0,
    )
    .await
    .unwrap();

    let snap = store
        .get_slo_status(&tenant, slo.id)
        .await
        .unwrap()
        .unwrap();
    let payload: SloStatusPayload = serde_json::from_value(snap.payload).unwrap();
    let keys: std::collections::BTreeSet<&str> = payload
        .window_computed_at
        .keys()
        .map(String::as_str)
        .collect();
    let expected: std::collections::BTreeSet<&str> = seven_day_windows.into_iter().collect();
    assert_eq!(
        keys, expected,
        "ledger must hold exactly the 7-day required windows, with the orphaned \
         3600s/259200s canonical windows pruned"
    );
}

/// A garbage (non-`SloStatusPayload`-shaped) prior snapshot must not permanently
/// freeze the SLO: `evaluate_slo` should self-heal by treating it like there was
/// no prior snapshot, recompute everything fresh, and write a real snapshot.
#[tokio::test]
async fn garbage_prior_payload_self_heals_instead_of_freezing() {
    let store = PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap();
    let tenant = TenantId::from_trusted("t4");
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/garbage_prior_payload_self_heals_instead_of_freezing",
        &spec(),
    )
    .await;

    let now = OffsetDateTime::now_utc();
    store
        .upsert_slo_status(
            slo.id,
            &tenant,
            &serde_json::json!({"not":"a payload"}),
            now,
        )
        .await
        .unwrap();

    let ch = StubCh {
        good: 99.0,
        valid: 100.0,
        calls: AtomicUsize::new(0),
    };
    cc::evaluator::slo::evaluate_slo(
        &store,
        &ch,
        &NoopBus,
        &cc::domain::NullSink,
        &slo,
        OffsetDateTime::now_utc(),
        30,
        3,
        0,
    )
    .await
    .expect("evaluate_slo must self-heal on a garbage prior payload, not error forever");

    let snap = store
        .get_slo_status(&tenant, slo.id)
        .await
        .unwrap()
        .unwrap();
    let payload: SloStatusPayload = serde_json::from_value(snap.payload)
        .expect("the new snapshot must be a well-formed SloStatusPayload");
    assert!(
        payload.sli.is_some(),
        "self-heal recomputes every window fresh, so the SLI must be populated"
    );
}
