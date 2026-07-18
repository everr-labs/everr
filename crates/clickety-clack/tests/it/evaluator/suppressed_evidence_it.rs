//! Evaluator-side contract for preview rules and event evidence:
//! - a suppressed rule's events are stamped `suppressed: true` (firing AND resolved);
//! - present instances carry bounded evidence (source-row columns minus `label_columns`,
//!   value column included); resolved-by-absence events carry none.

use async_trait::async_trait;
use cc::clickhouse::{ChError, ResultRow, RowQuerier};
use cc::domain::event::EventStatus;
use cc::domain::ids::TenantId;
use cc::domain::rule::{RuleSpec, Severity};
use cc::domain::Event;
use cc::evaluator::process_batch;
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{EvalJob, Queue};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use std::sync::Mutex;
use time::OffsetDateTime;
use uuid::Uuid;

struct FixedCh {
    rows: Mutex<Vec<ResultRow>>,
}

impl FixedCh {
    fn new(rows: Vec<ResultRow>) -> Self {
        Self {
            rows: Mutex::new(rows),
        }
    }
    fn set_rows(&self, rows: Vec<ResultRow>) {
        *self.rows.lock().unwrap() = rows;
    }
}

#[async_trait]
impl RowQuerier for FixedCh {
    async fn query_rows_params(
        &self,
        _tenant: &TenantId,
        _sql: &str,
        _params: &[(String, String)],
        _label_columns: &[String],
        _value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        Ok(self.rows.lock().unwrap().clone())
    }

    fn auth_identity(&self, tenant: &TenantId) -> cc::clickhouse::AuthIdentity {
        cc::clickhouse::AuthIdentity {
            user: tenant.as_str().to_string(),
        }
    }
}

use crate::common::RecordingBus;

fn spec(suppressed: bool) -> RuleSpec {
    RuleSpec {
        sql: "SELECT * FROM m".into(),
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec!["host".into()],
        value_column: Some("errors".into()),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed,
    }
}

fn row_with_evidence() -> ResultRow {
    ResultRow {
        labels: BTreeMap::from([("host".to_string(), "web-1".to_string())]),
        value: Some(7.0),
        extra: BTreeMap::from([
            ("errors".to_string(), serde_json::json!(7.0)),
            ("path".to_string(), serde_json::json!("/checkout")),
            ("region".to_string(), serde_json::json!("eu")),
        ]),
    }
}

async fn pg() -> PgStore {
    let url = crate::support::fresh_db().await;
    PgStore::connect(&url).await.unwrap()
}

async fn redis_queue() -> RedisQueue {
    let redis = crate::common::start_redis().await;
    let url = redis.url.clone();
    std::mem::forget(redis);
    RedisQueue::connect(&url).await.unwrap()
}

struct Ctx {
    store: PgStore,
    queue: RedisQueue,
    ch: FixedCh,
    bus: RecordingBus,
    tenant: TenantId,
}

impl Ctx {
    async fn run_eval(
        &self,
        rule: cc::domain::ids::RuleId,
        eval_ts: OffsetDateTime,
        consumer: &str,
    ) {
        self.queue
            .enqueue(&EvalJob {
                tenant: self.tenant.clone(),
                rule,
                eval_ts,
            })
            .await
            .unwrap();
        let deliveries = self.queue.consume(consumer, 10, 1000).await.unwrap();
        assert_eq!(deliveries.len(), 1);
        process_batch(&self.store, &self.ch, &self.bus, 1000, deliveries).await;
    }

    fn events(&self) -> Vec<Event> {
        self.bus.events.lock().unwrap().clone()
    }
}

#[tokio::test]
async fn suppressed_rule_stamps_firing_and_resolved_events() {
    let store = pg().await;
    let queue = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = store
        .create_rule(tenant.clone(), &spec(true))
        .await
        .unwrap();
    assert!(rule.spec.suppressed, "spec round-trips through the store");

    let ctx = Ctx {
        store,
        queue,
        ch: FixedCh::new(vec![row_with_evidence()]),
        bus: RecordingBus::default(),
        tenant,
    };
    let t0 = OffsetDateTime::now_utc();

    ctx.run_eval(rule.id, t0, "sup-a").await;
    // Row disappears: the firing instance resolves on the next eval.
    ctx.ch.set_rows(vec![]);
    ctx.run_eval(rule.id, t0 + time::Duration::seconds(30), "sup-b")
        .await;

    let events = ctx.events();
    assert_eq!(events.len(), 2, "one firing + one resolved: {events:?}");
    assert_eq!(events[0].status, EventStatus::Firing);
    assert_eq!(events[1].status, EventStatus::Resolved);
    for ev in events.iter() {
        assert!(ev.suppressed, "evaluator stamps the rule's suppressed flag");
    }
}

#[tokio::test]
async fn events_carry_bounded_evidence_and_absence_resolves_without_it() {
    let store = pg().await;
    let queue = redis_queue().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = store
        .create_rule(tenant.clone(), &spec(false))
        .await
        .unwrap();

    let ctx = Ctx {
        store,
        queue,
        ch: FixedCh::new(vec![row_with_evidence()]),
        bus: RecordingBus::default(),
        tenant,
    };
    let t0 = OffsetDateTime::now_utc();

    ctx.run_eval(rule.id, t0, "ev-a").await;
    ctx.ch.set_rows(vec![]);
    ctx.run_eval(rule.id, t0 + time::Duration::seconds(30), "ev-b")
        .await;

    let events = ctx.events();
    assert_eq!(events.len(), 2, "one firing + one resolved: {events:?}");

    let firing = &events[0];
    assert_eq!(firing.status, EventStatus::Firing);
    assert!(!firing.suppressed);
    let evidence = firing.evidence.as_ref().expect("firing carries evidence");
    assert!(
        !evidence.contains_key("host"),
        "label columns are excluded from evidence"
    );
    assert_eq!(
        evidence.get("errors"),
        Some(&serde_json::json!(7.0)),
        "the value column IS included"
    );
    assert_eq!(evidence.get("path"), Some(&serde_json::json!("/checkout")));
    assert_eq!(evidence.get("region"), Some(&serde_json::json!("eu")));
    assert!(!firing.evidence_truncated);

    let resolved = &events[1];
    assert_eq!(resolved.status, EventStatus::Resolved);
    assert_eq!(
        resolved.evidence, None,
        "resolved-by-absence has no source row, so no evidence"
    );
    assert!(!resolved.evidence_truncated);

    // Evidence is event-scoped only: the instances table stores labels + value, nothing more.
    let insts = ctx
        .store
        .load_instances(&rule.tenant, rule.id)
        .await
        .unwrap();
    assert_eq!(insts.len(), 1);
}

/// Old-format stream payloads (no suppressed/evidence fields) must deserialize through
/// the queue's Event wire format: the exact rolling-upgrade case for outbox + Redis.
#[test]
fn old_wire_payload_deserializes_with_defaults() {
    let old = r#"{
        "tenant": "t-1",
        "rule": "00000000-0000-0000-0000-000000000000",
        "instance_key": "k",
        "status": "firing",
        "kind": "alert",
        "labels": {"host": "web-1"},
        "value": 7.0,
        "severity": "warning",
        "annotations": {},
        "eval_ts": "2026-06-14T12:03:00Z"
    }"#;
    let ev: Event = serde_json::from_str(old).unwrap();
    assert!(!ev.suppressed);
    assert_eq!(ev.evidence, None);
    assert!(!ev.evidence_truncated);
}
