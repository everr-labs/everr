use cc::domain::ids::{RuleId, TenantId};
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{EvalJob, Queue};
use time::OffsetDateTime;
use uuid::Uuid;

#[tokio::test]
async fn enqueue_consume_ack_roundtrip() {
    let node = crate::common::start_redis().await;
    let url = node.url.clone();

    let q = RedisQueue::connect(&url).await.unwrap();
    let job = EvalJob {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        rule: RuleId(Uuid::nil()),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    };
    q.enqueue(&job).await.unwrap();

    let got = q.consume("c1", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].job, job);
    q.ack(&got[0].id).await.unwrap();
}
