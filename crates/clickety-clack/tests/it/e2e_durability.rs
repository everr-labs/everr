use crate::common;
use crate::support::create_test_rule;
use async_trait::async_trait;
use cc::clickhouse::ChClient;
use cc::dispatcher::DispatchCtx;
use cc::domain::ids::TenantId;
use cc::domain::rule::{RuleSpec, Severity};
use cc::domain::Event;
use cc::evaluator::maintenance::run_maintenance;
use cc::evaluator::run_evaluator;
use cc::queue::event_bus::RedisEventBus;
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{EvalJob, EventBus, EventEntry, EventId, Queue, QueueError};
use cc::stores::RedisLease;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use time::OffsetDateTime;
use uuid::Uuid;

type Captured = Arc<Mutex<Vec<serde_json::Value>>>;

/// EventBus wrapper whose FIRST publish fails (simulating the evaluator's inline publish
/// being lost), then delegates to the real bus. Everything else delegates.
struct FlakyBus {
    inner: RedisEventBus,
    failed_once: AtomicBool,
}

#[async_trait]
impl EventBus for FlakyBus {
    async fn publish(&self, ev: &Event) -> Result<(), QueueError> {
        if !self.failed_once.swap(true, Ordering::SeqCst) {
            // Simulate the evaluator's inline publish being lost.
            return Err(crate::common::queue_error());
        }
        self.inner.publish(ev).await
    }
    async fn consume(&self, c: &str, n: usize, b: usize) -> Result<Vec<EventEntry>, QueueError> {
        self.inner.consume(c, n, b).await
    }
    async fn ack(&self, id: &EventId) -> Result<(), QueueError> {
        self.inner.ack(id).await
    }
    async fn dead_letter(&self, ev: &Event, reason: &str) -> Result<(), QueueError> {
        self.inner.dead_letter(ev, reason).await
    }
}

async fn stub_webhook(captured: Captured) -> String {
    use axum::routing::post;
    use axum::{Json, Router};
    let app = Router::new().route(
        "/hook",
        post(move |Json(body): Json<serde_json::Value>| {
            let captured = captured.clone();
            async move {
                captured.lock().unwrap().push(body);
                "ok"
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{addr}/hook")
}

#[tokio::test]
async fn relay_recovers_dropped_inline_publish() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();
    let queue: Arc<dyn Queue> = Arc::new(RedisQueue::connect(&infra.redis.url).await.unwrap());
    let flaky = Arc::new(FlakyBus {
        inner: RedisEventBus::connect(&infra.redis.url).await.unwrap(),
        failed_once: AtomicBool::new(false),
    });
    let bus: Arc<dyn EventBus> = flaky.clone();

    let ch_auth =
        cc::clickhouse::build_ch_auth("shared", "default", "", None, None, "", None).unwrap();
    let ch = ChClient::new(common::stub_clickhouse().await, ch_auth);
    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    // Every worker runs on the flaky bus so the failure injection is shared.
    let ctx = DispatchCtx {
        bus: bus.clone(),
        ..common::dispatch_ctx(&infra)
    };
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    common::create_webhook_delivery(&store, ctx.cipher.as_ref(), tenant.clone(), &hook).await;
    let spec = RuleSpec {
        sql: "SELECT service, count() AS n FROM spans GROUP BY service".into(),
        interval_secs: 1,
        for_secs: 0,
        label_columns: vec!["service".into()],
        value_column: Some("n".into()),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    };
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/relay_recovers_dropped_inline_publish",
        &spec,
    )
    .await;

    let dispatcher = common::spawn_dispatcher(&ctx, true);

    let ev_handle = {
        let (store, queue, bus, rx) = (
            store.clone(),
            queue.clone(),
            bus.clone(),
            dispatcher.shutdown_rx(),
        );
        tokio::spawn(async move {
            run_evaluator(
                "e1".into(),
                store,
                queue,
                std::sync::Arc::new(ch),
                bus,
                3,
                cc::otel::EngineMetrics::disabled(),
                rx,
            )
            .await;
        })
    };

    let maint_handle = {
        let lease = RedisLease::connect(&infra.redis.url, "cc:maintenance:lease", "m1", 10_000)
            .await
            .unwrap();
        let (store, bus, rx) = (store.clone(), bus.clone(), dispatcher.shutdown_rx());
        tokio::spawn(async move {
            run_maintenance(
                store,
                bus,
                lease,
                Duration::from_millis(200),
                30,
                cc::otel::EngineMetrics::disabled(),
                rx,
            )
            .await;
        })
    };

    queue
        .enqueue(&EvalJob {
            tenant,
            rule: rule.id,
            eval_ts: OffsetDateTime::now_utc(),
        })
        .await
        .unwrap();

    for _ in 0..200 {
        if !captured.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    {
        let got = captured.lock().unwrap();
        assert_eq!(got.len(), 1, "relay recovered exactly one delivery");
        assert_eq!(got[0]["events"][0]["status"], "firing");
        assert_eq!(got[0]["events"][0]["labels"]["service"], "api");
    }

    assert!(
        flaky.failed_once.load(Ordering::Acquire),
        "failure injection never fired — the relay path was not exercised"
    );

    dispatcher.shutdown().await;
    let _ = ev_handle.await;
    let _ = maint_handle.await;
}
