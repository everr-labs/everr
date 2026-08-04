//! Shared support for the load-test harness (evaluator + dispatcher throughput).
//! Brings up Postgres + Redis via testcontainers, selects a ClickHouse backend,
//! and provides config, seed helpers, stub servers, and a report printer.
#![allow(dead_code)] // each test file uses a subset of these helpers

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use cc::clickhouse::{ChClient, RowQuerier};
use cc::crypto::{EnvKeyring, SecretCipher};
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::notify::WebhookNotifier;
use cc::dispatcher::{run_dispatcher, run_group_flusher, DispatchCtx, Notifiers};
use cc::domain::channel::ChannelConfig;
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::Severity;
use cc::domain::sink::NullSink;
use cc::domain::{Event, EventKind, EventStatus};
use cc::queue::event_bus::RedisEventBus;
use cc::queue::groups::{GroupStore, RedisGroups};
use cc::queue::{EventBus, EventEntry, EventId, QueueError};
use cc::stores::PgStore;
use std::sync::Mutex;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::core::IntoContainerPort;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::ContainerAsync;
use testcontainers_modules::testcontainers::GenericImage;
use testcontainers_modules::testcontainers::ImageExt;
use time::OffsetDateTime;
use tokio::task::JoinHandle;
use uuid::Uuid;

/// Which ClickHouse backing the harness uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChBackend {
    Stub,
    Real,
}

/// All harness knobs, resolved from env with defaults (see the design spec §6).
#[derive(Debug, Clone)]
pub struct LoadConfig {
    pub rules: usize,
    pub instances_per_rule: usize,
    pub eval_workers: usize,
    pub events: usize,
    pub dispatch_workers: usize,
    pub ch: ChBackend,
    pub coalesce: bool,
}

impl LoadConfig {
    pub fn from_env() -> Self {
        fn envn(k: &str, d: usize) -> usize {
            std::env::var(k)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(d)
        }
        let ch = match std::env::var("CC_LOAD_CH").as_deref() {
            Ok("real") => ChBackend::Real,
            _ => ChBackend::Stub,
        };
        let coalesce = matches!(std::env::var("CC_LOAD_COALESCE").as_deref(), Ok("1"));
        Self {
            rules: envn("CC_LOAD_RULES", 2000),
            instances_per_rule: envn("CC_LOAD_INSTANCES_PER_RULE", 20),
            eval_workers: envn("CC_LOAD_EVAL_WORKERS", 8),
            events: envn("CC_LOAD_EVENTS", 50_000),
            dispatch_workers: envn("CC_LOAD_DISPATCH_WORKERS", 8),
            ch,
            coalesce,
        }
    }
}

/// Postgres testcontainer + a connected, migrated store. Holds the container guard so it
/// stays alive for the test's lifetime.
pub struct Pg {
    pub _container: ContainerAsync<Postgres>,
    pub url: String,
    pub store: PgStore,
}

pub async fn start_pg() -> Pg {
    // Same major version as the dev/prod stack; the module default (postgres 11)
    // predates the built-in gen_random_uuid() used by migration 0014.
    let container = Postgres::default()
        .with_tag("18-alpine")
        .start()
        .await
        .unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    Pg {
        _container: container,
        url,
        store,
    }
}

/// Redis testcontainer + its URL.
pub struct RedisInfra {
    pub _container: ContainerAsync<Redis>,
    pub url: String,
}

pub async fn start_redis() -> RedisInfra {
    let container = Redis::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(6379).await.unwrap();
    let url = format!("redis://127.0.0.1:{port}");
    RedisInfra {
        _container: container,
        url,
    }
}

/// A deterministic in-memory cipher, matching the e2e tests' `test_cipher`.
pub fn test_cipher() -> Arc<dyn SecretCipher> {
    Arc::new(
        EnvKeyring::new(
            HashMap::from([("v1".to_string(), [7u8; 32])]),
            "v1".to_string(),
        )
        .unwrap(),
    )
}

/// A `QueueError` for bus doubles that must fail a publish. Names an explicit variant so a
/// `QueueError` refactor breaks at compile time rather than at runtime.
pub fn queue_error() -> QueueError {
    QueueError::Json(serde_json::from_str::<serde_json::Value>("x not json").unwrap_err())
}

/// Wall-clock millis, matching the dispatcher's internal `now_ms`.
pub fn now_ms() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

pub fn per_sec(count: usize, elapsed: Duration) -> f64 {
    count as f64 / elapsed.as_secs_f64()
}

/// Print a throughput report block to stderr (visible with `--nocapture`).
pub fn report(stage: &str, lines: &[(&str, String)]) {
    eprintln!("\n=== load report: {stage} ===");
    for (k, v) in lines {
        eprintln!("  {k:<28} {v}");
    }
    eprintln!(
        "  {:<28} machine/container-dependent; stub backends factor out CH server + webhook time.",
        "NOTE"
    );
    eprintln!("=== end {stage} ===\n");
}

/// One rule's SQL. Distinct per rule (trailing comment) so the evaluator's `QuerySig`
/// coalescing does NOT collapse the batch into a single round-trip — unless `coalesce`
/// forces identical SQL to measure the best case. `FROM load_rows` is ignored by the stub
/// and read from the seeded table by the real backend.
pub fn rule_sql(idx: usize, coalesce: bool) -> String {
    if coalesce {
        "SELECT svc, val FROM load_rows".to_string()
    } else {
        format!("SELECT svc, val FROM load_rows /* rule {idx} */")
    }
}

/// A JSONEachRow body of `rows` synthetic rows (svc label + val value).
pub fn jsoneachrow_body(rows: usize) -> String {
    let mut s = String::new();
    for i in 0..rows {
        s.push_str(&format!("{{\"svc\":\"svc-{i}\",\"val\":{i}}}\n"));
    }
    s
}

/// A live `RowQuerier` (real `ChClient`) plus the resources that must outlive it.
pub struct ChHandle {
    pub querier: Arc<dyn RowQuerier>,
    _stub: Option<JoinHandle<()>>,
    _container: Option<ContainerAsync<GenericImage>>,
}

/// Build the configured ClickHouse backend. `rows` is the per-query row count
/// (`instances_per_rule`).
pub async fn ch_backend(cfg: &LoadConfig, rows: usize) -> ChHandle {
    let auth =
        cc::clickhouse::build_ch_auth("shared", "default", "", None, None, "", None).unwrap();
    match cfg.ch {
        ChBackend::Stub => {
            let (url, handle) = start_ch_stub(rows).await;
            ChHandle {
                querier: Arc::new(ChClient::new(url, auth)),
                _stub: Some(handle),
                _container: None,
            }
        }
        ChBackend::Real => {
            let (url, container) = start_ch_real(rows).await;
            ChHandle {
                querier: Arc::new(ChClient::new(url, auth)),
                _stub: None,
                _container: Some(container),
            }
        }
    }
}

/// Axum stub that returns a fixed JSONEachRow body for any query — instant, no I/O.
async fn start_ch_stub(rows: usize) -> (String, JoinHandle<()>) {
    use axum::routing::post;
    use axum::Router;
    let body = jsoneachrow_body(rows);
    let app = Router::new().route(
        "/",
        post(move || {
            let body = body.clone();
            async move { body }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    (format!("http://{addr}/"), handle)
}

/// Real ClickHouse via a generic container. Exposes 8123 (HTTP), polls `/ping` until ready,
/// then seeds a `load_rows` table with `rows` rows. `ChClient` (HTTP/JSONEachRow) queries it.
async fn start_ch_real(rows: usize) -> (String, ContainerAsync<GenericImage>) {
    // SKIP_USER_SETUP leaves the built-in `default` user with an empty password and access
    // from anywhere — matching the `shared`/`default`/empty-key identity ChClient uses.
    // Without it, the image's user setup rejects the empty password with 403.
    let container = GenericImage::new("clickhouse/clickhouse-server", "24.3")
        .with_exposed_port(8123.tcp())
        .with_env_var("CLICKHOUSE_SKIP_USER_SETUP", "1")
        .start()
        .await
        .unwrap();
    let port = container.get_host_port_ipv4(8123).await.unwrap();
    let base = format!("http://127.0.0.1:{port}/");
    let http = reqwest::Client::new();

    // Readiness: poll /ping (CH returns "Ok.\n" with 200) for up to ~20s.
    let mut ready = false;
    for _ in 0..200 {
        if let Ok(resp) = http.get(format!("{base}ping")).send().await {
            if resp.status().is_success() {
                ready = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(ready, "clickhouse container did not become ready");

    // Seed with the same auth identity ChClient uses (default user, empty password);
    // modern ClickHouse images 403 an unauthenticated write.
    http.post(&base)
        .header("X-ClickHouse-User", "default")
        .header("X-ClickHouse-Key", "")
        .body("CREATE TABLE IF NOT EXISTS load_rows (svc String, val Float64) ENGINE = Memory")
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let mut insert = String::from("INSERT INTO load_rows FORMAT JSONEachRow\n");
    insert.push_str(&jsoneachrow_body(rows));
    http.post(&base)
        .header("X-ClickHouse-User", "default")
        .header("X-ClickHouse-Key", "")
        .body(insert)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    (base, container)
}

/// Distinct group values to spread events across groups so flush has real work
/// (group_by = ["svc"] in the seeded route → one group per svc value).
pub const GROUP_CARDINALITY: usize = 1000;

fn matcher(label: &str, value: &str) -> Matcher {
    Matcher {
        label: label.into(),
        op: MatchOp::Eq,
        value: value.into(),
    }
}

/// Seed a tenant with a webhook channel + a receiver referencing it, an all-matching
/// route (group_by=["svc"], group_wait=0 so groups are immediately due), a non-matching
/// active silence, and an inhibition rule. Returns the tenant id.
pub async fn seed_dispatch_tenant(
    store: &PgStore,
    cipher: &dyn SecretCipher,
    webhook_url: &str,
) -> TenantId {
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_channel(
            cipher,
            tenant.clone(),
            "ops-hook",
            &ChannelConfig::Webhook {
                url: webhook_url.to_string(),
            },
        )
        .await
        .unwrap();
    store
        .create_receiver(
            tenant.clone(),
            "ops",
            &["ops-hook".to_string()],
            &std::collections::BTreeMap::new(),
        )
        .await
        .unwrap();
    store
        .create_route(
            tenant.clone(),
            &[], // empty matchers → matches every event
            "ops",
            false,
            0,
            Some(&["svc".to_string()][..]),
            Some(0), // group_wait_secs = 0 → immediately due
            Some(0), // group_interval_secs = 0
            None,    // repeat_interval_secs
        )
        .await
        .unwrap();
    let now = OffsetDateTime::now_utc();
    store
        .create_silence(
            tenant.clone(),
            &[matcher("svc", "does-not-match")],
            now - time::Duration::seconds(1),
            now + time::Duration::hours(1),
            "",
            "",
        )
        .await
        .unwrap();
    store
        .create_inhibition(
            tenant.clone(),
            &[matcher("severity", "critical")],
            &[matcher("severity", "warning")],
            &["instance".to_string()][..],
        )
        .await
        .unwrap();
    tenant
}

/// Build event `i`, spread across `GROUP_CARDINALITY` svc values.
pub fn make_event(tenant: &TenantId, rule: RuleId, i: usize) -> Event {
    let labels: BTreeMap<String, String> =
        BTreeMap::from([("svc".to_string(), format!("svc-{}", i % GROUP_CARDINALITY))]);
    Event {
        tenant: tenant.clone(),
        rule,
        slo: None,
        name: String::new(),
        instance_key: InstanceKey::new(rule, &labels),
        status: EventStatus::Firing,
        kind: EventKind::Alert,
        labels,
        value: Some(1.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
        traceparent: None,
    }
}

/// An instant webhook that returns 200 and counts hits. Returns (url, counter, task).
/// A one-route stub webhook that answers `status` and captures the last JSON
/// body it saw into `body_sink`, for asserting on delivered payloads
/// (slack/discord suites).
pub async fn start_json_capture_server(
    status: u16,
    body_sink: Arc<Mutex<Option<serde_json::Value>>>,
) -> String {
    use axum::extract::Json;
    use axum::http::StatusCode;
    use axum::routing::post;
    use axum::Router;
    let code = StatusCode::from_u16(status).unwrap();
    let app = Router::new().route(
        "/hook",
        post(move |Json(body): Json<serde_json::Value>| {
            let sink = body_sink.clone();
            async move {
                *sink.lock().unwrap() = Some(body);
                code
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

pub async fn start_counting_webhook() -> (String, Arc<AtomicUsize>, JoinHandle<()>) {
    use axum::routing::post;
    use axum::Router;
    let count = Arc::new(AtomicUsize::new(0));
    let c = count.clone();
    let app = Router::new().route(
        "/hook",
        post(move || {
            let c = c.clone();
            async move {
                c.fetch_add(1, Ordering::Relaxed);
                "ok"
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    (format!("http://{addr}/hook"), count, handle)
}

/// The baseline event the notifier/queue/dispatcher suites start from: nil ids,
/// firing alert, warning severity, epoch timestamp, no labels/value/annotations.
/// Tests mutate the fields they care about on their copy.
pub fn base_event() -> Event {
    Event::new(
        TenantId::from_trusted(Uuid::nil().to_string()),
        RuleId(Uuid::nil()),
        InstanceKey("k".into()),
        EventStatus::Firing,
        BTreeMap::new(),
        None,
        Severity::Warning,
        BTreeMap::new(),
        OffsetDateTime::UNIX_EPOCH,
    )
}

/// Axum stub standing in for ClickHouse: returns one fixed JSONEachRow row
/// (`service=api, n=5`) for any query.
pub async fn stub_clickhouse() -> String {
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

/// Fresh Postgres (template clone via `support::fresh_db`) + a Redis container,
/// connected the way the dispatcher sees them. Holds the Redis guard alive.
pub struct DispatchInfra {
    pub redis: RedisInfra,
    pub store: PgStore,
    pub bus: Arc<dyn EventBus>,
    pub groups: Arc<dyn GroupStore>,
}

pub async fn dispatch_infra() -> DispatchInfra {
    let pg_url = crate::support::fresh_db().await;
    let redis = start_redis().await;
    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis.url).await.unwrap());
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis.url).await.unwrap());
    DispatchInfra {
        redis,
        store,
        bus,
        groups,
    }
}

/// The `DispatchCtx` every dispatcher test starts from: webhook-only notifiers,
/// `test_cipher`, a default-TTL `FilterCache`, and the null sink. Tests that need
/// more override individual fields with struct-update syntax.
pub fn dispatch_ctx(infra: &DispatchInfra) -> DispatchCtx {
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new(true)));
    DispatchCtx {
        store: infra.store.clone(),
        bus: infra.bus.clone(),
        notifiers: Arc::new(reg),
        groups: infra.groups.clone(),
        cache: Arc::new(FilterCache::new(infra.store.clone())),
        cipher: test_cipher(),
        sink: Arc::new(NullSink),
    }
}

/// Spawned dispatcher workers plus the shutdown switch that stops them.
pub struct DispatcherHandle {
    tx: tokio::sync::watch::Sender<bool>,
    handles: Vec<JoinHandle<()>>,
}

impl DispatcherHandle {
    /// A receiver on the same shutdown switch, for tests that spawn extra workers
    /// (evaluator, maintenance) that must stop with the dispatcher.
    pub fn shutdown_rx(&self) -> tokio::sync::watch::Receiver<bool> {
        self.tx.subscribe()
    }

    /// Flip the switch and join every worker spawned by `spawn_dispatcher`.
    pub async fn shutdown(self) {
        let _ = self.tx.send(true);
        for h in self.handles {
            let _ = h.await;
        }
    }
}

/// Spawn `run_dispatcher` (and the group flusher when `with_flusher`) on clones of `ctx`.
pub fn spawn_dispatcher(ctx: &DispatchCtx, with_flusher: bool) -> DispatcherHandle {
    let (tx, rx) = tokio::sync::watch::channel(false);
    let mut handles = Vec::new();
    {
        let (ctx, rx) = (ctx.clone(), rx.clone());
        handles.push(tokio::spawn(async move {
            run_dispatcher("d1".into(), ctx, rx).await;
        }));
    }
    if with_flusher {
        let ctx = ctx.clone();
        handles.push(tokio::spawn(async move {
            run_group_flusher(ctx, rx).await;
        }));
    }
    DispatcherHandle { tx, handles }
}

/// An `EventBus` that records everything published, for asserting on the exact
/// event stream (rule-health transitions, evidence payloads, ...).
#[derive(Default)]
pub struct RecordingBus {
    pub events: Mutex<Vec<Event>>,
}

impl RecordingBus {
    /// Count recorded rule-health events with the given status.
    pub fn health_count(&self, status: EventStatus) -> usize {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.kind == EventKind::RuleHealth && e.status == status)
            .count()
    }
}

#[async_trait::async_trait]
impl EventBus for RecordingBus {
    async fn publish(&self, ev: &Event) -> Result<(), QueueError> {
        self.events.lock().unwrap().push(ev.clone());
        Ok(())
    }
    async fn consume(
        &self,
        _consumer: &str,
        _count: usize,
        _block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        Ok(Vec::new())
    }
    async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
        Ok(())
    }
    async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
        Ok(())
    }
}

/// An `EventBus` that drops everything — used to isolate the evaluator from event publish
/// cost (that cost is the dispatcher stage's input, measured separately).
pub struct NoopBus;

#[async_trait::async_trait]
impl EventBus for NoopBus {
    async fn publish(&self, _ev: &Event) -> Result<(), QueueError> {
        Ok(())
    }
    async fn consume(
        &self,
        _consumer: &str,
        _count: usize,
        _block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        Ok(Vec::new())
    }
    async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
        Ok(())
    }
    async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
        Ok(())
    }
}
