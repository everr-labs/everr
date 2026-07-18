use cc::domain::event::Event;
use cc::domain::ids::{RuleId, TenantId};
use cc::queue::event_bus::RedisEventBus;
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{EvalJob, EventBus, Queue};
use std::sync::Arc;
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
    let mut e = crate::common::base_event();
    e.value = Some(1.0);
    e
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

async fn redis_url() -> (String, crate::common::RedisInfra) {
    let redis = crate::common::start_redis().await;
    (redis.url.clone(), redis)
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
