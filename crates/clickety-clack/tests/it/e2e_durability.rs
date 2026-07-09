use async_trait::async_trait;
use cc::clickhouse::ChClient;
use cc::crypto::{EnvKeyring, SecretCipher};
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::notify::WebhookNotifier;
use cc::dispatcher::{run_dispatcher, Notifiers};
use cc::domain::ids::TenantId;
use cc::domain::rule::{RuleSpec, Severity};
use cc::domain::Event;
use cc::evaluator::maintenance::run_maintenance;
use cc::evaluator::run_evaluator;
use cc::queue::event_bus::RedisEventBus;
use cc::queue::groups::{GroupStore, RedisGroups};
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{EvalJob, EventBus, EventEntry, EventId, Queue, QueueError};
use cc::stores::{PgStore, RedisLease};
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

type Captured = Arc<Mutex<Vec<serde_json::Value>>>;

fn test_cipher() -> Arc<dyn SecretCipher> {
    Arc::new(
        EnvKeyring::new(
            HashMap::from([("v1".to_string(), [7u8; 32])]),
            "v1".to_string(),
        )
        .unwrap(),
    )
}

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
            // Simulate the evaluator's inline publish being lost. Explicit variant so a
            // QueueError refactor breaks at compile time, not at runtime.
            return Err(QueueError::Json(
                serde_json::from_str::<serde_json::Value>("§ not json").unwrap_err(),
            ));
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

async fn stub_clickhouse() -> String {
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route(
        "/",
        post(|| async { "{\"service\":\"api\",\"n\":5}\n".to_string() }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{addr}/")
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
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let queue: Arc<dyn Queue> = Arc::new(RedisQueue::connect(&redis_url).await.unwrap());
    let flaky = Arc::new(FlakyBus {
        inner: RedisEventBus::connect(&redis_url).await.unwrap(),
        failed_once: AtomicBool::new(false),
    });
    let bus: Arc<dyn EventBus> = flaky.clone();

    let ch_auth =
        cc::clickhouse::build_ch_auth("shared", "default", "", None, None, "", None).unwrap();
    let ch = ChClient::new(stub_clickhouse().await, ch_auth);
    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    let cipher = test_cipher();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_subscription(cipher.as_ref(), tenant.clone(), &hook)
        .await
        .unwrap();
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
    let rule = store.create_rule(tenant.clone(), &spec).await.unwrap();

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);

    let ev_handle = {
        let (store, queue, bus, rx) = (store.clone(), queue.clone(), bus.clone(), sd_rx.clone());
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
        let lease = RedisLease::connect(&redis_url, "cc:maintenance:lease", "m1", 10_000)
            .await
            .unwrap();
        let (store, bus, rx) = (store.clone(), bus.clone(), sd_rx.clone());
        tokio::spawn(async move {
            run_maintenance(
                store,
                bus,
                lease,
                Duration::from_millis(200),
                cc::otel::EngineMetrics::disabled(),
                rx,
            )
            .await;
        })
    };

    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());
    let cache = Arc::new(FilterCache::new(store.clone()));
    let disp_handle = {
        let mut reg = Notifiers::new();
        reg.register(Arc::new(WebhookNotifier::new()));
        let notifiers = Arc::new(reg);
        let (store, bus, groups, cache, cipher, rx) = (
            store.clone(),
            bus.clone(),
            groups.clone(),
            cache.clone(),
            cipher.clone(),
            sd_rx.clone(),
        );
        tokio::spawn(async move {
            run_dispatcher(
                "d1".into(),
                store,
                bus,
                notifiers,
                groups,
                cache,
                cipher,
                std::sync::Arc::new(cc::domain::sink::NullSink),
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

    let _ = sd_tx.send(true);
    let _ = ev_handle.await;
    let _ = maint_handle.await;
    let _ = disp_handle.await;
}
