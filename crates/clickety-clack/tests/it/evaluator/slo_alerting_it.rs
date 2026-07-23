//! Plan 3's firing pipeline: `evaluate_slo` driving burn-rate verdicts through the
//! shared engine state machine, opening/resolving `slo_instances` and publishing
//! `Event`s to a real bus.

use crate::support::create_test_slo;
use async_trait::async_trait;
use cc::clickhouse::{AuthIdentity, ChError, ResultRow, RowQuerier};
use cc::domain::event::{EventKind, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, SourceId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::rule::Severity;
use cc::domain::slo::{SliSpec, SloSpec, TimeWindow};
use cc::engine::slo_math::SloStatusPayload;
use cc::queue::event_bus::RedisEventBus;
use cc::queue::EventBus;
use cc::stores::PgStore;
use std::collections::BTreeMap;
use std::sync::Mutex;
use time::OffsetDateTime;
use uuid::Uuid;

/// A stub querier that returns fixed good/valid for every window (so every tier's
/// long AND short window burn identically), mutable via [`StubCh::set`] so a test
/// can flip the SLI mid-flight (breach -> recovery) without a second SLO.
struct StubCh {
    good_valid: Mutex<(f64, f64)>,
}

impl StubCh {
    fn new(good: f64, valid: f64) -> Self {
        Self {
            good_valid: Mutex::new((good, valid)),
        }
    }
    fn set(&self, good: f64, valid: f64) {
        *self.good_valid.lock().unwrap() = (good, valid);
    }
}

#[async_trait]
impl RowQuerier for StubCh {
    async fn query_rows_params(
        &self,
        _t: &TenantId,
        _sql: &str,
        _p: &[(String, String)],
        _lc: &[String],
        _vc: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        let (good, valid) = *self.good_valid.lock().unwrap();
        Ok(vec![ResultRow {
            labels: BTreeMap::new(),
            value: Some(valid),
            extra: BTreeMap::from([("good".into(), serde_json::json!(good))]),
        }])
    }
    fn auth_identity(&self, t: &TenantId) -> AuthIdentity {
        AuthIdentity {
            user: t.as_str().to_string(),
        }
    }
}

/// A querier that always errors, to exercise `evaluate_slo`'s freeze-on-error path.
struct ErrCh;

#[async_trait]
impl RowQuerier for ErrCh {
    async fn query_rows_params(
        &self,
        _t: &TenantId,
        _s: &str,
        _p: &[(String, String)],
        _lc: &[String],
        _vc: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        Err(ChError::Http("boom".into()))
    }
    fn auth_identity(&self, t: &TenantId) -> AuthIdentity {
        AuthIdentity {
            user: t.as_str().to_string(),
        }
    }
}

/// Canonical-tier spec (fast-burn 14.4x, slow-burn 6.0x, ticket 1.0x), no
/// `min_valid_events` floor, over a 30d budget window.
fn spec(suppressed: bool) -> SloSpec {
    SloSpec {
        sli: SliSpec {
            sql: "SELECT countIf(ok) AS good, count() AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}".into(),
            label_columns: vec![],
        },
        target_percent: 99.9,
        time_window: TimeWindow {
            duration: "30d".into(),
            is_rolling: true,
            calendar: None,
        },
        min_valid_events: None,
        annotations: BTreeMap::new(),
        suppressed,
    }
}

async fn pg() -> PgStore {
    PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap()
}

/// A fresh Redis-backed bus. The container is leaked for the test process's
/// lifetime (mirrors `suppressed_evidence_it.rs`'s `redis_queue` helper) since
/// dropping it would tear down the container out from under the bus.
async fn redis_bus() -> RedisEventBus {
    let redis = crate::common::start_redis().await;
    let url = redis.url.clone();
    std::mem::forget(redis);
    RedisEventBus::connect(&url).await.unwrap()
}

/// Breach at 20x on every window (good=9800/valid=10000 against a 99.9% target:
/// bad ratio 0.02 / budget 0.001 = 20x), comfortably above every canonical tier's
/// threshold (fast-burn 14.4, slow-burn 6.0, ticket 1.0) with strict headroom.
#[tokio::test]
async fn breach_fires_and_recovery_resolves() {
    let store = pg().await;
    let bus = redis_bus().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/breach_fires_and_recovery_resolves",
        &spec(false),
    )
    .await;

    let ch = StubCh::new(9800.0, 10000.0);
    let t0 = OffsetDateTime::now_utc();
    cc::evaluator::slo::evaluate_slo(&store, &ch, &bus, &cc::domain::NullSink, &slo, t0, 30, 3)
        .await
        .unwrap();

    let got = bus.consume("alerting-fire", 10, 1000).await.unwrap();
    assert_eq!(
        got.len(),
        3,
        "fast-burn + slow-burn + ticket all breach at 20x: {got:?}"
    );
    for entry in &got {
        let ev = &entry.event;
        assert_eq!(ev.slo, Some(slo.id));
        assert_eq!(ev.kind, EventKind::Alert);
        assert_eq!(ev.status, EventStatus::Firing);
        let v = ev
            .value
            .expect("firing event carries the long-window burn rate");
        assert!((v - 20.0).abs() < 1e-6, "got {v}");
        let evidence = ev
            .evidence
            .as_ref()
            .expect("evidence present on a firing event");
        assert!(evidence.contains_key("burn_rate"));
        let summary = ev
            .annotations
            .get("summary")
            .expect("summary annotation present");
        assert!(summary.starts_with("SLO "), "got {summary:?}");
    }

    let insts = store.load_slo_instances(&tenant, slo.id).await.unwrap();
    assert_eq!(insts.len(), 3, "one instance per (group x tier): {insts:?}");
    assert!(
        insts.iter().all(|i| i.status == Status::Firing),
        "{insts:?}"
    );

    // ---- Recovery: force every window due again (seed window_computed_at into the
    // past on the stored snapshot) and flip the stub to zero burn.
    let snap = store
        .get_slo_status(&tenant, slo.id)
        .await
        .unwrap()
        .unwrap();
    let mut payload: SloStatusPayload = serde_json::from_value(snap.payload).unwrap();
    for ts in payload.window_computed_at.values_mut() {
        *ts = 0;
    }
    let t1 = t0 + time::Duration::seconds(60);
    store
        .upsert_slo_status(
            slo.id,
            &tenant,
            &serde_json::to_value(&payload).unwrap(),
            t1,
        )
        .await
        .unwrap();

    ch.set(10000.0, 10000.0); // burn 0x: fully recovered
    cc::evaluator::slo::evaluate_slo(&store, &ch, &bus, &cc::domain::NullSink, &slo, t1, 30, 3)
        .await
        .unwrap();

    let got2 = bus.consume("alerting-fire", 10, 1000).await.unwrap();
    assert_eq!(got2.len(), 3, "all three tiers resolve: {got2:?}");
    for entry in &got2 {
        assert_eq!(entry.event.status, EventStatus::Resolved);
        assert_eq!(entry.event.slo, Some(slo.id));
    }

    let insts2 = store.load_slo_instances(&tenant, slo.id).await.unwrap();
    assert_eq!(insts2.len(), 3);
    assert!(
        insts2.iter().all(|i| i.status == Status::Inactive),
        "{insts2:?}"
    );
}

#[tokio::test]
async fn suppressed_slo_marks_events() {
    let store = pg().await;
    let bus = redis_bus().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/suppressed_slo_marks_events",
        &spec(true),
    )
    .await;

    let ch = StubCh::new(9800.0, 10000.0); // 20x breach, same as the firing test
    cc::evaluator::slo::evaluate_slo(
        &store,
        &ch,
        &bus,
        &cc::domain::NullSink,
        &slo,
        OffsetDateTime::now_utc(),
        30,
        3,
    )
    .await
    .unwrap();

    let got = bus.consume("alerting-suppressed", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 3);
    for entry in &got {
        assert!(
            entry.event.suppressed,
            "a suppressed SLO's events must carry suppressed=true: {:?}",
            entry.event
        );
    }
}

/// burn == 0.9 (good=9991/valid=10000: bad ratio 0.0009 / budget 0.001 = 0.9), safely
/// under even the lowest canonical threshold (ticket, 1.0x) with margin to spare —
/// deliberately not the exact boundary, since `1.0 - 9990.0/10000.0` is not bit-exact
/// in f64 and can land a hair either side of the ticket tier's threshold.
#[tokio::test]
async fn no_events_below_threshold() {
    let store = pg().await;
    let bus = redis_bus().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/no_events_below_threshold",
        &spec(false),
    )
    .await;

    let ch = StubCh::new(9991.0, 10000.0);
    cc::evaluator::slo::evaluate_slo(
        &store,
        &ch,
        &bus,
        &cc::domain::NullSink,
        &slo,
        OffsetDateTime::now_utc(),
        30,
        3,
    )
    .await
    .unwrap();

    let got = bus.consume("alerting-below", 10, 1000).await.unwrap();
    assert!(
        got.is_empty(),
        "burn exactly at (not above) every tier's threshold must not fire: {got:?}"
    );

    let insts = store.load_slo_instances(&tenant, slo.id).await.unwrap();
    assert!(
        insts.iter().all(|i| i.status == Status::Inactive),
        "{insts:?}"
    );
}

/// A query error must freeze the SLO exactly like the rule evaluator: no new
/// events, and every existing `slo_instances` row left byte-for-byte as it was.
#[tokio::test]
async fn freeze_on_error_freezes_instances() {
    let store = pg().await;
    let bus = redis_bus().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/freeze_on_error_freezes_instances",
        &spec(false),
    )
    .await;

    // Seed a Firing instance directly (bypassing the firing pipeline entirely) so
    // there is something for a frozen tick to leave alone.
    let rule_id = RuleId(slo.id.0);
    let labels = BTreeMap::from([("slo_tier".to_string(), "fast-burn".to_string())]);
    let key = InstanceKey::new(rule_id, &labels);
    let mut inst = InstanceState::new_inactive(key, SourceId::Slo(slo.id), tenant.clone(), labels);
    // Truncate to whole microseconds: timestamptz round-trips at micro precision,
    // and the byte-for-byte assertion below must not depend on the host clock's
    // granularity (Linux hands out nanoseconds; macOS happens to stop at micros).
    let seeded_last_seen = OffsetDateTime::now_utc() - time::Duration::minutes(5);
    let seeded_last_seen = seeded_last_seen
        .replace_nanosecond(seeded_last_seen.microsecond() * 1000)
        .unwrap();
    inst.status = Status::Firing;
    inst.active_since = Some(seeded_last_seen);
    inst.last_seen = Some(seeded_last_seen);
    store.persist_slo_eval_batch(&[inst], &[]).await.unwrap();

    cc::evaluator::slo::evaluate_slo(
        &store,
        &ErrCh,
        &bus,
        &cc::domain::NullSink,
        &slo,
        OffsetDateTime::now_utc(),
        30,
        3,
    )
    .await
    .unwrap();

    let got = bus.consume("alerting-freeze", 10, 1000).await.unwrap();
    assert!(got.is_empty(), "error path must never publish: {got:?}");

    let insts = store.load_slo_instances(&tenant, slo.id).await.unwrap();
    assert_eq!(insts.len(), 1);
    assert_eq!(insts[0].status, Status::Firing, "unchanged: {insts:?}");
    assert_eq!(
        insts[0].last_seen,
        Some(seeded_last_seen),
        "the frozen tick must not touch the seeded instance's last_seen"
    );
}

/// A `slo_instances` row for a tier name no longer in the spec's (canonical) tiers --
/// e.g. left behind by an earlier spec edit -- is never re-planned by
/// `plan_tier_firing`, so it falls into `evaluate_slo`'s "known-but-not-planned"
/// leftover loop and resolves with no matching tier. That path's severity now goes
/// through the same shared `tier_severity` helper as `stores::pg`'s
/// `list_firing_slos`/`list_stale_slo_instances`, so it must default to Critical, not
/// the old inline `Warning` fallback.
#[tokio::test]
async fn leftover_instance_with_unknown_tier_resolves_severity_as_critical() {
    let store = pg().await;
    let bus = redis_bus().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/leftover_instance_with_unknown_tier_resolves_severity_as_critical",
        &spec(false),
    )
    .await;

    let rule_id = RuleId(slo.id.0);
    let labels = BTreeMap::from([("slo_tier".to_string(), "ghost-tier".to_string())]);
    let key = InstanceKey::new(rule_id, &labels);
    let mut inst = InstanceState::new_inactive(key, SourceId::Slo(slo.id), tenant.clone(), labels);
    let seeded_last_seen = OffsetDateTime::now_utc() - time::Duration::minutes(5);
    inst.status = Status::Firing;
    inst.active_since = Some(seeded_last_seen);
    inst.last_seen = Some(seeded_last_seen);
    store.persist_slo_eval_batch(&[inst], &[]).await.unwrap();

    // 0x burn on every canonical tier: nothing new fires, so the only event out of
    // this tick is the ghost-tier instance resolving via the leftover loop.
    let ch = StubCh::new(10000.0, 10000.0);
    cc::evaluator::slo::evaluate_slo(
        &store,
        &ch,
        &bus,
        &cc::domain::NullSink,
        &slo,
        OffsetDateTime::now_utc(),
        30,
        3,
    )
    .await
    .unwrap();

    let got = bus.consume("alerting-ghost-tier", 10, 1000).await.unwrap();
    let resolved = got
        .iter()
        .find(|e| e.event.labels.get("slo_tier").map(String::as_str) == Some("ghost-tier"))
        .expect("the ghost-tier instance must resolve via the leftover loop");
    assert_eq!(resolved.event.status, EventStatus::Resolved);
    assert_eq!(
        resolved.event.severity,
        Severity::Critical,
        "unknown-tier resolve events go through the shared tier_severity default \
         (Critical), unifying with stores::pg's fallback"
    );
}

/// A query error crossing `degrade_after` publishes an `SloHealth` (wire: `RuleHealth`)
/// event with `slo` set on the bus, mirroring the rule evaluator's health-event path.
#[tokio::test]
async fn erroring_slo_publishes_health_event() {
    let store = pg().await;
    let bus = redis_bus().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let slo = create_test_slo(
        &store,
        tenant.clone(),
        "t/erroring_slo_publishes_health_event",
        &spec(false),
    )
    .await;

    cc::evaluator::slo::evaluate_slo(
        &store,
        &ErrCh,
        &bus,
        &cc::domain::NullSink,
        &slo,
        OffsetDateTime::now_utc(),
        30,
        1,
    )
    .await
    .unwrap();

    let got = bus.consume("slo-health", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1, "one degrade health event: {got:?}");
    let ev = &got[0].event;
    assert_eq!(ev.kind, EventKind::RuleHealth);
    assert_eq!(ev.slo, Some(slo.id));
    assert_eq!(ev.status, EventStatus::Firing);
    assert!(
        ev.annotations
            .get("summary")
            .expect("summary annotation present")
            .contains("degraded"),
        "{ev:?}"
    );
}
