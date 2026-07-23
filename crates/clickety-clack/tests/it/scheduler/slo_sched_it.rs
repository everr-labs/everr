use crate::support::create_test_slo;
use cc::domain::ids::TenantId;
use cc::domain::slo::{SliSpec, SloSpec, TimeWindow};
use cc::queue::redis_streams::RedisQueue;
use cc::queue::Queue;
use cc::stores::PgStore;
use std::collections::BTreeMap;

#[tokio::test]
async fn tick_enqueues_due_slo_jobs() {
    let pg = crate::support::fresh_db().await;
    let store = PgStore::connect(&pg).await.unwrap();

    let node = crate::common::start_redis().await;
    let url = node.url.clone();
    let queue = RedisQueue::connect(&url).await.unwrap();

    let spec = SloSpec {
        sli: SliSpec {
            sql: "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}".into(),
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
        suppressed: false,
    };
    let slo = create_test_slo(&store, TenantId::from_trusted("t"), "s", &spec).await;

    // one tick with a single shard owning everything
    cc::scheduler::tick_slos_once(&store, &queue, 100, &[0], 1, 30)
        .await
        .unwrap();

    let got = queue.consume_slo("c", 10, 500).await.unwrap();
    assert!(got.iter().any(|d| d.job.slo == slo.id));
}
