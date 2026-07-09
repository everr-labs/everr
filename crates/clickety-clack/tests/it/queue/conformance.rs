use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::rule::Severity;
use cc::queue::event_bus::RedisEventBus;
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{EvalJob, EventBus, Queue};
use std::collections::BTreeMap;
use std::sync::Arc;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

fn job() -> EvalJob {
    EvalJob {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        rule: RuleId(Uuid::nil()),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

fn ev() -> Event {
    Event {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("k".into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::new(),
        value: Some(1.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    }
}

// ---- backend-agnostic contract assertions ----

async fn queue_enqueue_consume_ack(q: Arc<dyn Queue>) {
    q.enqueue(&job()).await.unwrap();
    let got = q.consume("c1", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1, "enqueued job must be delivered");
    assert_eq!(got[0].job, job());
    q.ack(&got[0].id).await.unwrap();
    let after = q.consume("c1", 10, 300).await.unwrap();
    assert!(after.is_empty(), "acked job must not be redelivered as new");
}

async fn eventbus_consume_ack(bus: Arc<dyn EventBus>) {
    bus.publish(&ev()).await.unwrap();
    let got = bus.consume("d1", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].event, ev());
    bus.ack(&got[0].id).await.unwrap();
    let after = bus.consume("d1", 10, 300).await.unwrap();
    assert!(
        after.is_empty(),
        "acked event must not be redelivered as new"
    );
}

async fn eventbus_dead_letter(bus: Arc<dyn EventBus>) {
    bus.dead_letter(&ev(), "boom").await.unwrap();
}

async fn redis_url() -> (
    String,
    testcontainers_modules::testcontainers::ContainerAsync<Redis>,
) {
    let node = Redis::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    (format!("redis://127.0.0.1:{port}"), node)
}

#[tokio::test]
async fn redis_queue_conforms() {
    let (url, _node) = redis_url().await;
    let q: Arc<dyn Queue> = Arc::new(RedisQueue::connect(&url).await.unwrap());
    queue_enqueue_consume_ack(q).await;
}

#[tokio::test]
async fn redis_event_bus_conforms() {
    let (url, _node) = redis_url().await;
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&url).await.unwrap());
    eventbus_consume_ack(bus.clone()).await;
    eventbus_dead_letter(bus).await;
}
