//! Durability-based acknowledgement: a delivery is acked ONLY when its work reached a
//! durable terminal state. These tests force each store operation the evaluator performs
//! to fail (via a `FaultInjector` that wraps a real `PgStore` and forwards every call
//! except the one under test) and assert the correct ack / no-ack decision. A no-ack means
//! the job stays pending for the reclaim pre-pass, which is what closes the P0 where a
//! transient store/Redis/ClickHouse failure permanently consumed the job.

use crate::common::NoopBus;
use crate::support::{create_test_rule, create_test_slo};
use async_trait::async_trait;
use cc::clickhouse::{ChError, ResultRow, RowQuerier};
use cc::domain::ids::{RuleId, SloId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::rule::{RuleSpec, Severity};
use cc::domain::slo::{SliSpec, Slo, SloSpec, TimeWindow};
use cc::domain::{Event, NullSink};
use cc::evaluator::{
    process_batch_inner, slo::process_slo_batch_inner, OutboxStore, RuleEvalStore, SloEvalStore,
};
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{
    Delivery, EvalJob, EventBus, EventEntry, EventId, Queue, QueueError, SloDelivery, SloEvalJob,
};
use cc::stores::{EvalCadence, PersistOutcome, PgStore, SloStatusRow, StoreError};
use std::collections::{BTreeMap, HashMap};
use time::OffsetDateTime;
use uuid::Uuid;

// ---- Which single store op the injector should fail. ----
#[derive(Clone, Copy, PartialEq)]
enum FailAt {
    None,
    GetRules,
    LoadInstances,
    Persist,
    RecordRuleFailure,
    GetSlos,
    PersistSlo,
    RecordSloFailure,
}

fn boom() -> StoreError {
    // Any store error stands in for a transient infrastructure failure.
    StoreError::Sqlx(sqlx::Error::PoolClosed)
}

/// Wraps a real `PgStore` and forwards every seam call to it, except the one op named by
/// `fail`, which returns an error instead. This forces a specific infrastructure failure at
/// a chosen point in the evaluation pipeline without a broken database.
struct FaultInjector<'a> {
    inner: &'a PgStore,
    fail: FailAt,
}

impl OutboxStore for FaultInjector<'_> {
    async fn delete_outbox(&self, id: Uuid) -> Result<(), StoreError> {
        self.inner.delete_outbox(id).await
    }
    async fn delete_outbox_batch(&self, ids: &[Uuid]) -> Result<(), StoreError> {
        self.inner.delete_outbox_batch(ids).await
    }
}

impl RuleEvalStore for FaultInjector<'_> {
    async fn get_rules_by_ids(
        &self,
        ids: &[RuleId],
    ) -> Result<Vec<cc::domain::rule::Rule>, StoreError> {
        if self.fail == FailAt::GetRules {
            return Err(boom());
        }
        self.inner.get_rules_by_ids(ids).await
    }
    async fn record_rule_failure(
        &self,
        rule: RuleId,
        tenant: &TenantId,
        err: &str,
        threshold: i32,
        now: OffsetDateTime,
        claim: Option<(RuleId, OffsetDateTime)>,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        if self.fail == FailAt::RecordRuleFailure {
            return Err(boom());
        }
        self.inner
            .record_rule_failure(rule, tenant, err, threshold, now, claim)
            .await
    }
    async fn record_rule_success(
        &self,
        rule: RuleId,
        tenant: &TenantId,
        now: OffsetDateTime,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        self.inner.record_rule_success(rule, tenant, now).await
    }
    async fn load_instances(
        &self,
        tenant: &TenantId,
        rule: RuleId,
    ) -> Result<Vec<InstanceState>, StoreError> {
        if self.fail == FailAt::LoadInstances {
            return Err(boom());
        }
        self.inner.load_instances(tenant, rule).await
    }
    async fn persist_eval_batch(
        &self,
        instances: &[InstanceState],
        events: &[Event],
        rollup: Option<(RuleId, cc::domain::rollup::RuleRollup)>,
        cadence: Option<(RuleId, EvalCadence)>,
        rule_tenant: Option<&TenantId>,
        claim: Option<(RuleId, OffsetDateTime)>,
    ) -> Result<PersistOutcome, StoreError> {
        if self.fail == FailAt::Persist {
            return Err(boom());
        }
        self.inner
            .persist_eval_batch(instances, events, rollup, cadence, rule_tenant, claim)
            .await
    }
}

impl SloEvalStore for FaultInjector<'_> {
    async fn get_slos_by_ids(&self, ids: &[SloId]) -> Result<Vec<Slo>, StoreError> {
        if self.fail == FailAt::GetSlos {
            return Err(boom());
        }
        self.inner.get_slos_by_ids(ids).await
    }
    async fn get_slo_status(
        &self,
        tenant: &TenantId,
        slo: SloId,
    ) -> Result<Option<SloStatusRow>, StoreError> {
        self.inner.get_slo_status(tenant, slo).await
    }
    async fn record_slo_failure(
        &self,
        slo: SloId,
        tenant: &TenantId,
        err: &str,
        degrade_after: u32,
        now: OffsetDateTime,
        claim: Option<(SloId, OffsetDateTime)>,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        if self.fail == FailAt::RecordSloFailure {
            return Err(boom());
        }
        self.inner
            .record_slo_failure(slo, tenant, err, degrade_after, now, claim)
            .await
    }
    async fn record_slo_success(
        &self,
        slo: SloId,
        tenant: &TenantId,
        now: OffsetDateTime,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        self.inner.record_slo_success(slo, tenant, now).await
    }
    async fn load_slo_instances(
        &self,
        tenant: &TenantId,
        slo: SloId,
    ) -> Result<Vec<InstanceState>, StoreError> {
        self.inner.load_slo_instances(tenant, slo).await
    }
    async fn persist_slo_eval(
        &self,
        slo: SloId,
        tenant: &TenantId,
        payload: &serde_json::Value,
        computed_at: OffsetDateTime,
        instances: &[InstanceState],
        events: &[Event],
        claim: Option<(SloId, OffsetDateTime)>,
    ) -> Result<PersistOutcome, StoreError> {
        if self.fail == FailAt::PersistSlo {
            return Err(boom());
        }
        self.inner
            .persist_slo_eval(slo, tenant, payload, computed_at, instances, events, claim)
            .await
    }
}

// ---- ClickHouse doubles. ----

/// Returns one present row (rule fires immediately at for_secs=0).
struct OkCh;
#[async_trait]
impl RowQuerier for OkCh {
    async fn query_rows_params(
        &self,
        _t: &TenantId,
        _sql: &str,
        _p: &[(String, String)],
        _l: &[String],
        _v: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        // For SLO queries the value column is `valid` and `good` is an extra; a rule query
        // ignores `extra`. One row that both shapes can read.
        let mut extra = BTreeMap::new();
        extra.insert("good".to_string(), serde_json::json!(1.0));
        let mut labels = BTreeMap::new();
        labels.insert("host".to_string(), "a".to_string());
        Ok(vec![ResultRow {
            extra,
            labels,
            value: Some(1.0),
        }])
    }
    fn auth_identity(&self, tenant: &TenantId) -> cc::clickhouse::AuthIdentity {
        cc::clickhouse::AuthIdentity {
            user: tenant.as_str().to_string(),
        }
    }
}

/// Always errors (exercises the query-failure / freeze path).
struct ErrCh;
#[async_trait]
impl RowQuerier for ErrCh {
    async fn query_rows_params(
        &self,
        _t: &TenantId,
        _sql: &str,
        _p: &[(String, String)],
        _l: &[String],
        _v: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        Err(ChError::Status(500, "boom".into()))
    }
    fn auth_identity(&self, tenant: &TenantId) -> cc::clickhouse::AuthIdentity {
        cc::clickhouse::AuthIdentity {
            user: tenant.as_str().to_string(),
        }
    }
}

/// An EventBus whose publish always fails (to prove a publish failure is still a durable ack
/// — the outbox relay recovers it).
struct FailBus;
#[async_trait]
impl EventBus for FailBus {
    async fn publish(&self, _ev: &Event) -> Result<(), QueueError> {
        Err(QueueError::Json(
            serde_json::from_str::<serde_json::Value>("§ not json").unwrap_err(),
        ))
    }
    async fn consume(&self, _c: &str, _n: usize, _b: usize) -> Result<Vec<EventEntry>, QueueError> {
        Ok(Vec::new())
    }
    async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
        Ok(())
    }
    async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
        Ok(())
    }
}

// ---- Helpers. ----

async fn pg() -> PgStore {
    PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap()
}
async fn redis_queue() -> (RedisQueue, crate::common::RedisInfra) {
    let redis = crate::common::start_redis().await;
    let q = RedisQueue::connect(&redis.url).await.unwrap();
    (q, redis)
}
fn rule_spec() -> RuleSpec {
    RuleSpec {
        sql: "SELECT * FROM m".into(),
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec!["host".into()],
        value_column: Some("v".into()),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    }
}
fn slo_spec() -> SloSpec {
    SloSpec {
        sli: SliSpec {
            sql: "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}".into(),
            label_columns: vec![],
        },
        target_percent: 99.9,
        time_window: TimeWindow { duration: "30d".into(), is_rolling: true, calendar: None },
        min_valid_events: None,
        annotations: BTreeMap::new(),
        suppressed: false,
    }
}

/// Enqueue one rule job and drain it into a `Delivery` (whose sealed `JobId` can only come
/// from the queue).
async fn rule_delivery(
    q: &RedisQueue,
    tenant: &TenantId,
    rule: RuleId,
    ts: OffsetDateTime,
) -> Vec<Delivery> {
    q.enqueue(&EvalJob {
        tenant: tenant.clone(),
        rule,
        eval_ts: ts,
    })
    .await
    .unwrap();
    q.consume(&Uuid::new_v4().to_string(), 10, 1000)
        .await
        .unwrap()
}
async fn slo_delivery(
    q: &RedisQueue,
    tenant: &TenantId,
    slo: SloId,
    ts: OffsetDateTime,
) -> Vec<SloDelivery> {
    q.enqueue_slo(&SloEvalJob {
        tenant: tenant.clone(),
        slo,
        eval_ts: ts,
    })
    .await
    .unwrap();
    q.consume_slo(&Uuid::new_v4().to_string(), 10, 1000)
        .await
        .unwrap()
}

async fn run_rule(
    store: &PgStore,
    fail: FailAt,
    ch: &dyn RowQuerier,
    bus: &dyn EventBus,
    deliveries: Vec<Delivery>,
) -> Vec<cc::queue::JobId> {
    let faulty = FaultInjector { inner: store, fail };
    let mut health: HashMap<RuleId, bool> = HashMap::new();
    process_batch_inner(
        &faulty,
        ch,
        bus,
        1000,
        deliveries,
        &mut health,
        &cc::otel::metrics::EngineMetrics::disabled(),
    )
    .await
}

// ================= Rule path =================

#[tokio::test]
async fn rule_get_rules_failure_leaves_batch_unacked() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(&store, tenant.clone(), "t/dur-get-rules", &rule_spec()).await;
    let d = rule_delivery(&q, &tenant, rule.id, OffsetDateTime::now_utc()).await;

    let acked = run_rule(&store, FailAt::GetRules, &OkCh, &NoopBus, d).await;
    assert!(
        acked.is_empty(),
        "a rule-fetch failure must ack nothing (whole batch reclaims)"
    );
}

#[tokio::test]
async fn rule_persist_failure_leaves_job_unacked() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(&store, tenant.clone(), "t/dur-persist", &rule_spec()).await;
    let d = rule_delivery(&q, &tenant, rule.id, OffsetDateTime::now_utc()).await;

    let acked = run_rule(&store, FailAt::Persist, &OkCh, &NoopBus, d).await;
    assert!(
        acked.is_empty(),
        "a persist failure must leave the job unacked for reclaim"
    );
    // The claim rode the (failed) persist transaction, so nothing was committed: the eval_ts
    // is NOT in the ledger and a redelivery can re-evaluate.
    let ledger: i64 = sqlx::query_scalar("SELECT count(*) FROM evaluations WHERE rule = $1")
        .bind(rule.id.0)
        .fetch_one(store.pool_for_test())
        .await
        .unwrap();
    assert_eq!(ledger, 0, "a failed persist must not leave a claim behind");
}

#[tokio::test]
async fn rule_load_instances_failure_leaves_job_unacked() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(&store, tenant.clone(), "t/dur-load", &rule_spec()).await;
    let d = rule_delivery(&q, &tenant, rule.id, OffsetDateTime::now_utc()).await;

    let acked = run_rule(&store, FailAt::LoadInstances, &OkCh, &NoopBus, d).await;
    assert!(
        acked.is_empty(),
        "an instance-load failure must leave the job unacked"
    );
}

#[tokio::test]
async fn rule_query_error_with_record_failure_error_leaves_job_unacked() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(&store, tenant.clone(), "t/dur-recfail", &rule_spec()).await;
    let d = rule_delivery(&q, &tenant, rule.id, OffsetDateTime::now_utc()).await;

    // Query fails AND recording that failure fails: the failure is not durable -> reclaim.
    let acked = run_rule(&store, FailAt::RecordRuleFailure, &ErrCh, &NoopBus, d).await;
    assert!(
        acked.is_empty(),
        "an unrecorded failure must leave the job unacked"
    );
}

#[tokio::test]
async fn rule_query_error_recorded_is_acked() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(&store, tenant.clone(), "t/dur-recok", &rule_spec()).await;
    let d = rule_delivery(&q, &tenant, rule.id, OffsetDateTime::now_utc()).await;

    // Query fails but the failure IS durably recorded (claiming the eval_ts) -> ack.
    let acked = run_rule(&store, FailAt::None, &ErrCh, &NoopBus, d).await;
    assert_eq!(
        acked.len(),
        1,
        "a durably-recorded query failure is acked exactly once"
    );
}

#[tokio::test]
async fn rule_publish_failure_is_still_acked() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(&store, tenant.clone(), "t/dur-pub", &rule_spec()).await;
    let d = rule_delivery(&q, &tenant, rule.id, OffsetDateTime::now_utc()).await;

    // State + outbox are committed; only publish fails. The relay recovers it, so the job
    // is durably complete and must be acked (not reclaimed).
    let acked = run_rule(&store, FailAt::None, &OkCh, &FailBus, d).await;
    assert_eq!(
        acked.len(),
        1,
        "a publish failure is durable (relay recovers) -> acked"
    );
    assert_eq!(
        store.load_instances(&rule.tenant, rule.id).await.unwrap()[0].status,
        Status::Firing,
        "the eval was persisted despite the publish failure"
    );
}

#[tokio::test]
async fn rule_redelivery_of_applied_eval_is_acked_without_double_write() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = create_test_rule(&store, tenant.clone(), "t/dur-redeliver", &rule_spec()).await;
    let ts = OffsetDateTime::now_utc();

    let d1 = rule_delivery(&q, &tenant, rule.id, ts).await;
    let acked1 = run_rule(&store, FailAt::None, &OkCh, &NoopBus, d1).await;
    assert_eq!(acked1.len(), 1, "first delivery applies and is acked");

    // Redeliver the SAME (rule, eval_ts): the persist claim conflicts (already applied), so
    // it writes nothing and is acked anyway.
    let d2 = rule_delivery(&q, &tenant, rule.id, ts).await;
    let acked2 = run_rule(&store, FailAt::None, &OkCh, &NoopBus, d2).await;
    assert_eq!(
        acked2.len(),
        1,
        "a redelivered, already-applied eval is still acked"
    );
    let ledger: i64 = sqlx::query_scalar("SELECT count(*) FROM evaluations WHERE rule = $1")
        .bind(rule.id.0)
        .fetch_one(store.pool_for_test())
        .await
        .unwrap();
    assert_eq!(
        ledger, 1,
        "the eval_ts was claimed exactly once across both deliveries"
    );
}

// ================= SLO path =================

async fn run_slo(
    store: &PgStore,
    fail: FailAt,
    ch: &dyn RowQuerier,
    bus: &dyn EventBus,
    deliveries: Vec<SloDelivery>,
) -> Vec<cc::queue::JobId> {
    let faulty = FaultInjector { inner: store, fail };
    process_slo_batch_inner(&faulty, ch, bus, &NullSink, 30, 3, deliveries).await
}

#[tokio::test]
async fn slo_get_slos_failure_leaves_batch_unacked() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let slo = create_test_slo(&store, tenant.clone(), "dur-getslos", &slo_spec()).await;
    let d = slo_delivery(&q, &tenant, slo.id, OffsetDateTime::now_utc()).await;

    let acked = run_slo(&store, FailAt::GetSlos, &OkCh, &NoopBus, d).await;
    assert!(acked.is_empty(), "an SLO-fetch failure must ack nothing");
}

#[tokio::test]
async fn slo_persist_failure_leaves_job_unacked() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let slo = create_test_slo(&store, tenant.clone(), "dur-persistslo", &slo_spec()).await;
    let d = slo_delivery(&q, &tenant, slo.id, OffsetDateTime::now_utc()).await;

    let acked = run_slo(&store, FailAt::PersistSlo, &OkCh, &NoopBus, d).await;
    assert!(
        acked.is_empty(),
        "an SLO persist failure must leave the job unacked"
    );
    let ledger: i64 = sqlx::query_scalar("SELECT count(*) FROM slo_evaluations WHERE slo = $1")
        .bind(slo.id.0)
        .fetch_one(store.pool_for_test())
        .await
        .unwrap();
    assert_eq!(ledger, 0, "a failed SLO persist leaves no claim behind");
}

#[tokio::test]
async fn slo_query_error_with_record_failure_error_leaves_job_unacked() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let slo = create_test_slo(&store, tenant.clone(), "dur-slorecfail", &slo_spec()).await;
    let d = slo_delivery(&q, &tenant, slo.id, OffsetDateTime::now_utc()).await;

    let acked = run_slo(&store, FailAt::RecordSloFailure, &ErrCh, &NoopBus, d).await;
    assert!(
        acked.is_empty(),
        "an unrecorded SLO freeze must leave the job unacked"
    );
}

#[tokio::test]
async fn slo_query_error_recorded_is_acked() {
    let store = pg().await;
    let (q, _r) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let slo = create_test_slo(&store, tenant.clone(), "dur-slorecok", &slo_spec()).await;
    let d = slo_delivery(&q, &tenant, slo.id, OffsetDateTime::now_utc()).await;

    let acked = run_slo(&store, FailAt::None, &ErrCh, &NoopBus, d).await;
    assert_eq!(
        acked.len(),
        1,
        "a durably-recorded SLO freeze is acked exactly once"
    );
}
