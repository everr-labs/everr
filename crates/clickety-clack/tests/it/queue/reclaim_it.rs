use cc::domain::ids::{RuleId, SloId, TenantId};
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{EvalJob, Queue, SloEvalJob};
use std::time::Duration;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::ImageExt;
use time::OffsetDateTime;
use uuid::Uuid;

// XAUTOCLAIM requires Redis >= 6.2; the module's default image (5.0, matched by
// the other queue suites so they track the oldest Redis clickety-clack still
// supports) predates it, so this suite alone pins a newer image.
const RECLAIM_CAPABLE_TAG: &str = "7-alpine";

#[tokio::test]
async fn stale_pending_rule_job_is_reclaimed_by_another_consumer() {
    let node = Redis::default()
        .with_tag(RECLAIM_CAPABLE_TAG)
        .start()
        .await
        .unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    let url = format!("redis://127.0.0.1:{port}");

    let a = RedisQueue::connect(&url).await.unwrap();
    let job = EvalJob {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        rule: RuleId(Uuid::nil()),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    };
    a.enqueue(&job).await.unwrap();

    // Consumer A claims the job but never acks it (simulating a crash mid-job).
    let claimed = a.consume("consumer-a", 10, 1000).await.unwrap();
    assert_eq!(claimed.len(), 1);

    tokio::time::sleep(Duration::from_millis(20)).await;

    // Consumer B, with a near-zero reclaim threshold, steals the stale PEL entry.
    let b = RedisQueue::connect(&url)
        .await
        .unwrap()
        .with_reclaim_idle_ms(1);
    let reclaimed = b.consume("consumer-b", 10, 300).await.unwrap();
    assert_eq!(reclaimed.len(), 1);
    assert_eq!(reclaimed[0].job, job);
    b.ack(&reclaimed[0].id).await.unwrap();

    let after = b.consume("consumer-b", 10, 300).await.unwrap();
    assert!(
        after.is_empty(),
        "acked reclaimed job must not be redelivered"
    );
}

#[tokio::test]
async fn stale_pending_slo_job_is_reclaimed_by_another_consumer() {
    let node = Redis::default()
        .with_tag(RECLAIM_CAPABLE_TAG)
        .start()
        .await
        .unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    let url = format!("redis://127.0.0.1:{port}");

    let a = RedisQueue::connect(&url).await.unwrap();
    let job = SloEvalJob {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        slo: SloId(Uuid::nil()),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    };
    a.enqueue_slo(&job).await.unwrap();

    // Consumer A claims the job but never acks it (simulating a crash mid-job).
    let claimed = a.consume_slo("consumer-a", 10, 1000).await.unwrap();
    assert_eq!(claimed.len(), 1);

    tokio::time::sleep(Duration::from_millis(20)).await;

    // Consumer B, with a near-zero reclaim threshold, steals the stale PEL entry.
    let b = RedisQueue::connect(&url)
        .await
        .unwrap()
        .with_reclaim_idle_ms(1);
    let reclaimed = b.consume_slo("consumer-b", 10, 300).await.unwrap();
    assert_eq!(reclaimed.len(), 1);
    assert_eq!(reclaimed[0].job, job);
    b.ack_slo(&reclaimed[0].id).await.unwrap();

    let after = b.consume_slo("consumer-b", 10, 300).await.unwrap();
    assert!(
        after.is_empty(),
        "acked reclaimed job must not be redelivered"
    );
}
