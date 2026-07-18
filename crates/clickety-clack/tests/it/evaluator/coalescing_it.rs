use async_trait::async_trait;
use cc::clickhouse::{ChError, ResultRow, RowQuerier};
use cc::domain::event::{EventKind, EventStatus};
use cc::domain::ids::TenantId;
use cc::domain::instance::Status;
use cc::domain::rule::{RuleSpec, Severity};
use cc::domain::Event;
use cc::evaluator::process_batch;
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{EvalJob, EventBus, EventEntry, EventId, Queue, QueueError};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

struct CountingCh {
    rows: Vec<ResultRow>,
    calls: AtomicUsize,
}

#[async_trait]
impl RowQuerier for CountingCh {
    async fn query_rows_params(
        &self,
        _tenant: &TenantId,
        _sql: &str,
        _params: &[(String, String)],
        _label_columns: &[String],
        _value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.rows.clone())
    }

    fn auth_identity(&self, tenant: &TenantId) -> cc::clickhouse::AuthIdentity {
        cc::clickhouse::AuthIdentity {
            user: tenant.as_str().to_string(),
            settings: Vec::new(),
        }
    }
}

struct NoopBus;

#[async_trait]
impl EventBus for NoopBus {
    async fn publish(&self, _ev: &Event) -> Result<(), QueueError> {
        Ok(())
    }
    async fn consume(&self, _c: &str, _n: usize, _b: usize) -> Result<Vec<EventEntry>, QueueError> {
        Ok(vec![])
    }
    async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
        Ok(())
    }
    async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
        Ok(())
    }
}

fn spec(sql: &str) -> RuleSpec {
    RuleSpec {
        sql: sql.into(),
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

fn one_row() -> Vec<ResultRow> {
    let mut labels = BTreeMap::new();
    labels.insert("host".to_string(), "a".to_string());
    vec![ResultRow {
        extra: BTreeMap::new(),
        labels,
        value: Some(1.0),
    }]
}

async fn pg() -> (PgStore, impl Sized) {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    (store, ())
}

async fn redis_queue() -> (
    RedisQueue,
    testcontainers_modules::testcontainers::ContainerAsync<Redis>,
) {
    let node = Redis::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    let q = RedisQueue::connect(&format!("redis://127.0.0.1:{port}"))
        .await
        .unwrap();
    (q, node)
}

#[tokio::test]
async fn identical_sql_runs_one_query_both_rules_fire() {
    let (store, _pg) = pg().await;
    let (queue, _redis) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    let r1 = store
        .create_rule(tenant.clone(), &spec("SELECT * FROM m"))
        .await
        .unwrap();
    let r2 = store
        .create_rule(tenant.clone(), &spec("SELECT * FROM m"))
        .await
        .unwrap();

    let now = OffsetDateTime::now_utc();
    for r in [&r1, &r2] {
        queue
            .enqueue(&EvalJob {
                tenant: tenant.clone(),
                rule: r.id,
                eval_ts: now,
            })
            .await
            .unwrap();
    }
    let deliveries = queue.consume("identical", 10, 1000).await.unwrap();
    assert_eq!(deliveries.len(), 2);

    let ch = CountingCh {
        rows: one_row(),
        calls: AtomicUsize::new(0),
    };
    let acked = process_batch(&store, &ch, &NoopBus, 1000, deliveries).await;

    assert_eq!(acked.len(), 2, "both deliveries acked");
    assert_eq!(
        ch.calls.load(Ordering::SeqCst),
        1,
        "identical signatures must coalesce into one ClickHouse query"
    );

    for r in [&r1, &r2] {
        let insts = store.load_instances(&r.tenant, r.id).await.unwrap();
        assert_eq!(insts.len(), 1, "rule produced one instance");
        assert_eq!(insts[0].status, Status::Firing);
    }
}

#[tokio::test]
async fn identical_sql_different_tenants_runs_two_queries() {
    // Same SQL/labels/value but different tenants must NOT share a round-trip: the
    // resolved auth identity differs per tenant, so coalescing must not cross tenants.
    let (store, _pg) = pg().await;
    let (queue, _redis) = redis_queue().await;
    let ta = TenantId::from_trusted("ta");
    let tb = TenantId::from_trusted("tb");

    let ra = store
        .create_rule(ta.clone(), &spec("SELECT * FROM m"))
        .await
        .unwrap();
    let rb = store
        .create_rule(tb.clone(), &spec("SELECT * FROM m"))
        .await
        .unwrap();

    let now = OffsetDateTime::now_utc();
    for (t, r) in [(&ta, &ra), (&tb, &rb)] {
        queue
            .enqueue(&EvalJob {
                tenant: t.clone(),
                rule: r.id,
                eval_ts: now,
            })
            .await
            .unwrap();
    }
    let deliveries = queue.consume("cross-tenant", 10, 1000).await.unwrap();
    assert_eq!(deliveries.len(), 2);

    let ch = CountingCh {
        rows: one_row(),
        calls: AtomicUsize::new(0),
    };
    let acked = process_batch(&store, &ch, &NoopBus, 1000, deliveries).await;

    assert_eq!(acked.len(), 2, "both deliveries acked");
    assert_eq!(
        ch.calls.load(Ordering::SeqCst),
        2,
        "identical SQL from different tenants must not coalesce (per-tenant identity)"
    );

    for r in [&ra, &rb] {
        let insts = store.load_instances(&r.tenant, r.id).await.unwrap();
        assert_eq!(insts.len(), 1, "rule produced one instance");
        assert_eq!(insts[0].status, Status::Firing);
    }
}

#[tokio::test]
async fn differing_sql_runs_two_queries() {
    let (store, _pg) = pg().await;
    let (queue, _redis) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    let r1 = store
        .create_rule(tenant.clone(), &spec("SELECT * FROM a"))
        .await
        .unwrap();
    let r2 = store
        .create_rule(tenant.clone(), &spec("SELECT * FROM b"))
        .await
        .unwrap();

    let now = OffsetDateTime::now_utc();
    for r in [&r1, &r2] {
        queue
            .enqueue(&EvalJob {
                tenant: tenant.clone(),
                rule: r.id,
                eval_ts: now,
            })
            .await
            .unwrap();
    }
    let deliveries = queue.consume("differing", 10, 1000).await.unwrap();
    assert_eq!(deliveries.len(), 2);

    let ch = CountingCh {
        rows: one_row(),
        calls: AtomicUsize::new(0),
    };
    let acked = process_batch(&store, &ch, &NoopBus, 1000, deliveries).await;
    assert_eq!(acked.len(), 2);
    assert_eq!(
        ch.calls.load(Ordering::SeqCst),
        2,
        "distinct signatures must each run their own query"
    );

    for r in [&r1, &r2] {
        let insts = store.load_instances(&r.tenant, r.id).await.unwrap();
        assert_eq!(insts.len(), 1, "rule produced one instance");
        assert_eq!(insts[0].status, Status::Firing);
    }
}

#[tokio::test]
async fn paused_rule_inflight_job_is_not_evaluated() {
    // Scheduler claim-exclusion gates NEW jobs, but a job enqueued just before a
    // pause can be drained just after it. That in-flight job must not evaluate the
    // paused rule — otherwise a cleared condition would emit a misleading Resolved.
    let (store, _pg) = pg().await;
    let (queue, _redis) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = store
        .create_rule(tenant.clone(), &spec("SELECT * FROM m"))
        .await
        .unwrap();

    // 1) Evaluate once while active with a present row -> the instance fires.
    let t1 = OffsetDateTime::now_utc();
    queue
        .enqueue(&EvalJob {
            tenant: tenant.clone(),
            rule: rule.id,
            eval_ts: t1,
        })
        .await
        .unwrap();
    let d1 = queue.consume("paused-a", 10, 1000).await.unwrap();
    let ch1 = CountingCh {
        rows: one_row(),
        calls: AtomicUsize::new(0),
    };
    process_batch(&store, &ch1, &NoopBus, 1000, d1).await;
    assert_eq!(
        store.load_instances(&rule.tenant, rule.id).await.unwrap()[0].status,
        Status::Firing
    );

    // 2) Pause the rule.
    store.pause_rule(tenant.clone(), rule.id).await.unwrap();

    // 3) Drain a stale in-flight job with the row now ABSENT. If the paused rule were
    //    evaluated, the firing instance would resolve and the query would run.
    let t2 = t1 + time::Duration::seconds(1);
    queue
        .enqueue(&EvalJob {
            tenant,
            rule: rule.id,
            eval_ts: t2,
        })
        .await
        .unwrap();
    let d2 = queue.consume("paused-b", 10, 1000).await.unwrap();
    assert_eq!(d2.len(), 1);
    let ch2 = CountingCh {
        rows: vec![],
        calls: AtomicUsize::new(0),
    };
    let acked = process_batch(&store, &ch2, &NoopBus, 1000, d2).await;

    assert_eq!(acked.len(), 1, "the in-flight job is still acked");
    assert_eq!(
        ch2.calls.load(Ordering::SeqCst),
        0,
        "a paused rule must not be queried"
    );
    assert_eq!(
        store.load_instances(&rule.tenant, rule.id).await.unwrap()[0].status,
        Status::Firing,
        "paused rule's firing instance must NOT be resolved by an in-flight job"
    );
}

/// A ClickHouse double that errors while `fail` is set, else returns `rows`.
struct FlakyCh {
    rows: Vec<ResultRow>,
    fail: AtomicBool,
}

impl FlakyCh {
    fn new(fail: bool) -> Self {
        Self {
            rows: one_row(),
            fail: AtomicBool::new(fail),
        }
    }
    fn set_fail(&self, v: bool) {
        self.fail.store(v, Ordering::SeqCst);
    }
}

#[async_trait]
impl RowQuerier for FlakyCh {
    async fn query_rows_params(
        &self,
        _tenant: &TenantId,
        _sql: &str,
        _params: &[(String, String)],
        _label_columns: &[String],
        _value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        if self.fail.load(Ordering::SeqCst) {
            Err(ChError::Status(500, "boom".into()))
        } else {
            Ok(self.rows.clone())
        }
    }

    fn auth_identity(&self, tenant: &TenantId) -> cc::clickhouse::AuthIdentity {
        cc::clickhouse::AuthIdentity {
            user: tenant.as_str().to_string(),
            settings: Vec::new(),
        }
    }
}

/// An event bus that records everything published, for asserting health transitions.
#[derive(Default)]
struct RecordingBus {
    events: Mutex<Vec<Event>>,
}

impl RecordingBus {
    fn health_count(&self, status: EventStatus) -> usize {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.kind == EventKind::RuleHealth && e.status == status)
            .count()
    }
}

#[async_trait]
impl EventBus for RecordingBus {
    async fn publish(&self, ev: &Event) -> Result<(), QueueError> {
        self.events.lock().unwrap().push(ev.clone());
        Ok(())
    }
    async fn consume(&self, _c: &str, _n: usize, _b: usize) -> Result<Vec<EventEntry>, QueueError> {
        Ok(vec![])
    }
    async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
        Ok(())
    }
    async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
        Ok(())
    }
}

#[tokio::test]
async fn repeated_query_errors_degrade_then_recover() {
    let (store, _pg) = pg().await;
    let (queue, _redis) = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = store
        .create_rule(tenant.clone(), &spec("SELECT * FROM m"))
        .await
        .unwrap();

    let ch = FlakyCh::new(true);
    let bus = RecordingBus::default();
    let base = OffsetDateTime::now_utc();

    // K = 2: two failing batches (distinct eval_ts so each claims) degrade the rule once.
    for i in 0..2 {
        let ts = base + time::Duration::seconds(i);
        queue
            .enqueue(&EvalJob {
                tenant: tenant.clone(),
                rule: rule.id,
                eval_ts: ts,
            })
            .await
            .unwrap();
        let d = queue.consume(&format!("fail-{i}"), 10, 1000).await.unwrap();
        process_batch(&store, &ch, &bus, 2, d).await;
    }
    assert_eq!(
        bus.health_count(EventStatus::Firing),
        1,
        "two failures at K=2 emit exactly one RuleHealth/Firing"
    );

    // Now succeed: exactly one RuleHealth/Resolved.
    ch.set_fail(false);
    let ts = base + time::Duration::seconds(10);
    queue
        .enqueue(&EvalJob {
            tenant: tenant.clone(),
            rule: rule.id,
            eval_ts: ts,
        })
        .await
        .unwrap();
    let d = queue.consume("recover", 10, 1000).await.unwrap();
    process_batch(&store, &ch, &bus, 2, d).await;
    assert_eq!(
        bus.health_count(EventStatus::Resolved),
        1,
        "first success after degrade emits exactly one RuleHealth/Resolved"
    );
}
