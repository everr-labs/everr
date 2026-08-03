use cc::domain::ids::{SloId, TenantId};
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{Queue, SloEvalJob};
use time::OffsetDateTime;
use uuid::Uuid;

#[tokio::test]
async fn slo_jobs_enqueue_consume_ack_roundtrip() {
    let node = crate::common::start_redis().await;
    let url = node.url.clone();

    let q = RedisQueue::connect(&url).await.unwrap();
    let job = SloEvalJob {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        slo: SloId(Uuid::nil()),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    };
    q.enqueue_slo(&job).await.unwrap();

    let got = q.consume_slo("c1", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].job, job);
    q.ack_slo(&got[0].id).await.unwrap();

    let after = q.consume_slo("c1", 10, 300).await.unwrap();
    assert!(after.is_empty(), "acked job must not be redelivered as new");
}
