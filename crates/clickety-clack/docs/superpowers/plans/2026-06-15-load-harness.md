# Load/Throughput Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `#[ignore]`d integration tests that measure the throughput clickety-clack sustains over real Postgres + Redis — evaluator rules/sec + evaluations/sec, and dispatcher events/sec + deliveries/sec — using the real production components.

**Architecture:** Workspace-level integration tests under `tests/` plus a shared `tests/common/mod.rs`. Postgres + Redis run via testcontainers (as the e2e suite already does); ClickHouse is either an instant Axum stub (headline) or a real `GenericImage` container (cross-check). Each test seeds a workload, runs a discarded warm-up pass, then a measured pass under wall-clock using bounded driver loops that call the genuine inner functions (`process_batch_inner`, `process_event`, `flush_group`), asserts the full workload completed, and prints a throughput report.

**Tech Stack:** Rust, tokio, sqlx/Postgres, Redis streams, reqwest, axum (stub servers), testcontainers + testcontainers-modules.

**Reference spec:** `docs/superpowers/specs/2026-06-15-load-harness-design.md`

---

## TDD adaptation (read first)

This is a measurement harness, not feature logic — there is no smaller unit of "behavior" to assert than "the harness runs the real pipeline and all work completes." So the red/green gate for each test task is:

1. **Red:** `cargo test --release --test <name> --no-run` fails to compile (code not written yet), OR the test's completion assertion fails.
2. **Green:** it compiles, and the controller runs it once with `--ignored --nocapture` and sees (a) the correctness assertions pass and (b) a throughput report printed.

The container/`--ignored` runs require Docker; the controller (not a cargo-sandboxed subagent) executes those run steps. Subagents write code and run `--no-run` compile checks + `cargo clippy`.

## File structure

| File | Responsibility |
|---|---|
| `crates/dispatcher/src/lib.rs` | (modify) expose `process_event` + `flush_group` as `pub` |
| `tests/common/mod.rs` | config, infra bring-up, cipher, CH backend, `NoopBus`, dispatch seed, stub webhooks, report printer |
| `tests/load_smoke.rs` | smoke test that exercises `common` (infra + CH backend) so it compiles and works |
| `tests/load_evaluator.rs` | evaluator rules/sec + evaluations/sec |
| `tests/load_dispatcher.rs` | dispatcher ingest events/sec + flush deliveries/sec |
| `docs/load-testing.md` | how to run + interpret |

---

## Task 1: Expose dispatcher per-event and per-group seams

**Files:**
- Modify: `crates/dispatcher/src/lib.rs` (the `process_event` fn ~line 99 and `flush_group` fn ~line 275)

The bounded driver loops in the dispatcher load tests need to call the genuine per-event and per-group functions. They are currently private. Make them `pub` with a doc note (same precedent as `cc_clickhouse::parse_rows`).

- [ ] **Step 1: Make `process_event` public**

In `crates/dispatcher/src/lib.rs`, change the existing signature:

```rust
/// Resolve an event to its delivery plan. Routed events are buffered into their group(s)
```
…from `async fn process_event(` to:

```rust
/// Public so the load-test harness can drive a single event; not a stable API.
pub async fn process_event(
```
(Keep the body and all parameters unchanged.)

- [ ] **Step 2: Make `flush_group` public**

In the same file, change `async fn flush_group(` to:

```rust
/// Public so the load-test harness can drive a single group flush; not a stable API.
pub async fn flush_group(
```
(Keep the body and all parameters unchanged.)

- [ ] **Step 3: Verify it builds**

Run: `cargo build -p cc-dispatcher`
Expected: compiles clean.

- [ ] **Step 4: Verify clippy is clean**

Run: `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`
Expected: no warnings (the now-`pub` fns are used by `run_dispatcher`/`run_group_flusher`, so no dead-code).

- [ ] **Step 5: Commit**

```bash
git add crates/dispatcher/src/lib.rs
git commit -m "Expose process_event and flush_group for the load harness"
```

---

## Task 2: Harness config, infra bring-up, cipher, and report printer

**Files:**
- Create: `tests/common/mod.rs`
- Create: `tests/load_smoke.rs`

This task lays the support foundation and proves it with a smoke test that brings up Postgres + Redis.

- [ ] **Step 1: Create `tests/common/mod.rs` with config, infra, cipher, report**

```rust
//! Shared support for the load-test harness (evaluator + dispatcher throughput).
//! Brings up Postgres + Redis via testcontainers, selects a ClickHouse backend,
//! and provides config, seed helpers, stub servers, and a report printer.
#![allow(dead_code)] // each test file uses a subset of these helpers

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use cc_crypto::{EnvKeyring, SecretCipher};
use cc_stores::PgStore;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::ContainerAsync;
use time::OffsetDateTime;

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
            std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d)
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
    let container = Postgres::default().start().await.unwrap();
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
        "  {:<28} {}",
        "NOTE",
        "machine/container-dependent; stub backends factor out CH server + webhook time."
    );
    eprintln!("=== end {stage} ===\n");
}
```

- [ ] **Step 2: Create `tests/load_smoke.rs`**

```rust
mod common;
use common::*;

/// Proves the support layer wires up: Postgres + Redis come up and connect.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "load harness; needs Docker. Run: cargo test --release --test load_smoke -- --ignored --nocapture"]
async fn smoke_infra_up() {
    let cfg = LoadConfig::from_env();
    let pg = start_pg().await;
    let redis = start_redis().await;
    assert!(pg.url.starts_with("postgres://"));
    assert!(redis.url.starts_with("redis://"));
    report(
        "smoke",
        &[
            ("rules (cfg)", cfg.rules.to_string()),
            ("events (cfg)", cfg.events.to_string()),
        ],
    );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo test --release --test load_smoke --no-run`
Expected: compiles clean.

- [ ] **Step 4 (controller, Docker): run the smoke test**

Run: `cargo test --release --test load_smoke -- --ignored --nocapture`
Expected: PASS, prints `=== load report: smoke ===`.

- [ ] **Step 5: Commit**

```bash
git add tests/common/mod.rs tests/load_smoke.rs
git commit -m "Add load-harness support: config, infra bring-up, report printer"
```

---

## Task 3: ClickHouse backend (instant stub + real container)

**Files:**
- Modify: `tests/common/mod.rs`
- Modify: `tests/load_smoke.rs`

Add a `ch_backend(&cfg)` that returns a real `Arc<dyn RowQuerier>` (a `ChClient`) plus a handle that keeps the stub server / container alive. The stub returns `instances_per_rule` synthetic JSONEachRow rows instantly; the real backend seeds a `load_rows` table in a `GenericImage` ClickHouse.

- [ ] **Step 1: Add CH imports and the SQL/body helpers to `tests/common/mod.rs`**

Add these imports near the top:

```rust
use cc_clickhouse::{ChClient, RowQuerier};
use testcontainers_modules::testcontainers::core::IntoContainerPort;
use testcontainers_modules::testcontainers::GenericImage;
use tokio::task::JoinHandle;
```

Add these helpers:

```rust
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
```

- [ ] **Step 2: Add the backend type + builder to `tests/common/mod.rs`**

```rust
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
        cc_clickhouse::build_ch_auth("shared", "default", "", None, None, "", None).unwrap();
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
    let container = GenericImage::new("clickhouse/clickhouse-server", "24.3")
        .with_exposed_port(8123.tcp())
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

    http.post(&base)
        .body("CREATE TABLE IF NOT EXISTS load_rows (svc String, val Float64) ENGINE = Memory")
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let mut insert = String::from("INSERT INTO load_rows FORMAT JSONEachRow\n");
    insert.push_str(&jsoneachrow_body(rows));
    http.post(&base)
        .body(insert)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    (base, container)
}
```

- [ ] **Step 3: Extend the smoke test to query the CH backend**

Replace `tests/load_smoke.rs` body of `smoke_infra_up` with a version that also queries the backend:

```rust
mod common;
use common::*;

#[tokio::test(flavor = "multi_thread")]
#[ignore = "load harness; needs Docker. Run: cargo test --release --test load_smoke -- --ignored --nocapture"]
async fn smoke_infra_up() {
    let cfg = LoadConfig::from_env();
    let pg = start_pg().await;
    let redis = start_redis().await;
    assert!(pg.url.starts_with("postgres://"));
    assert!(redis.url.starts_with("redis://"));

    let ch = ch_backend(&cfg, cfg.instances_per_rule).await;
    let tenant = cc_domain::ids::TenantId::from_trusted("smoke".to_string());
    let rows = ch
        .querier
        .query_rows(&tenant, &rule_sql(0, cfg.coalesce), &["svc".to_string()], Some("val"))
        .await
        .unwrap();
    assert_eq!(rows.len(), cfg.instances_per_rule, "backend returns N rows");

    report(
        "smoke",
        &[
            ("CH backend", format!("{:?}", cfg.ch)),
            ("rows returned", rows.len().to_string()),
        ],
    );
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo test --release --test load_smoke --no-run`
Expected: compiles clean.

- [ ] **Step 5 (controller, Docker): run the stub smoke test**

Run: `cargo test --release --test load_smoke -- --ignored --nocapture`
Expected: PASS; report shows `CH backend Stub`, `rows returned 20`.

- [ ] **Step 6 (controller, Docker, optional): run the real-CH smoke test**

Run: `CC_LOAD_CH=real cargo test --release --test load_smoke -- --ignored --nocapture`
Expected: PASS; report shows `CH backend Real`, `rows returned 20`. (If the `clickhouse/clickhouse-server` image can't be pulled in this environment, note it and rely on the stub path; the real path is a cross-check, not the headline.)

- [ ] **Step 7: Commit**

```bash
git add tests/common/mod.rs tests/load_smoke.rs
git commit -m "Add ClickHouse backends (instant stub + real container) to load harness"
```

---

## Task 4: Evaluator throughput test (rules/sec + evaluations/sec)

**Files:**
- Modify: `tests/common/mod.rs` (add `NoopBus`)
- Create: `tests/load_evaluator.rs`

- [ ] **Step 1: Add `NoopBus` to `tests/common/mod.rs`**

Add imports:

```rust
use cc_domain::Event;
use cc_queue::{EventBus, EventEntry, EventId, QueueError, TailCursor};
```

Add the type:

```rust
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
    async fn tail(
        &self,
        _cursor: &TailCursor,
        _count: usize,
        _block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        Ok(Vec::new())
    }
    async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
        Ok(())
    }
}
```

> Note: confirm the exact `EventBus` trait method set + the `TailCursor`/`QueueError` paths against `crates/queue/src/lib.rs` while implementing; match them exactly. If `tail` is absent or named differently, mirror the trait.

- [ ] **Step 2: Create `tests/load_evaluator.rs`**

```rust
mod common;
use common::*;

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use cc_domain::ids::TenantId;
use cc_domain::rule::{RuleId, RuleSpec, Severity};
use cc_evaluator::process_batch_inner;
use cc_queue::redis_streams::RedisQueue;
use cc_queue::{EvalJob, Queue, RowQuerierArc};
use std::collections::BTreeMap;
use time::OffsetDateTime;
use uuid::Uuid;

/// Enqueue one job per rule (untimed), then drain the queue with `workers` bounded workers
/// running the genuine steady-state loop. Returns the drain wall-clock.
async fn run_pass(
    store: &cc_stores::PgStore,
    ch: Arc<dyn cc_clickhouse::RowQuerier>,
    queue: &Arc<dyn Queue>,
    workers: usize,
    tenant: &TenantId,
    rule_ids: &[RuleId],
    eval_ts: OffsetDateTime,
) -> std::time::Duration {
    for &rule in rule_ids {
        queue
            .enqueue(&EvalJob {
                tenant: tenant.clone(),
                rule,
                eval_ts,
            })
            .await
            .unwrap();
    }

    let total = rule_ids.len();
    let processed = Arc::new(AtomicUsize::new(0));
    let t0 = Instant::now();
    let mut handles = Vec::new();
    for w in 0..workers {
        let store = store.clone();
        let ch = ch.clone();
        let queue = queue.clone();
        let processed = processed.clone();
        handles.push(tokio::spawn(async move {
            let consumer = format!("eval-w{w}");
            let mut health: HashMap<RuleId, bool> = HashMap::new();
            loop {
                if processed.load(Ordering::Relaxed) >= total {
                    break;
                }
                let deliveries = queue.consume(&consumer, 16, 100).await.unwrap();
                if deliveries.is_empty() {
                    if processed.load(Ordering::Relaxed) >= total {
                        break;
                    }
                    continue;
                }
                let n = deliveries.len();
                let acks =
                    process_batch_inner(&store, ch.as_ref(), &NoopBus, 3, deliveries, &mut health)
                        .await;
                for id in &acks {
                    queue.ack(id).await.unwrap();
                }
                processed.fetch_add(n, Ordering::Relaxed);
            }
        }));
    }
    for h in handles {
        h.await.unwrap();
    }
    t0.elapsed()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "load harness; needs Docker. Run: cargo test --release --test load_evaluator -- --ignored --nocapture"]
async fn load_evaluator_throughput() {
    let cfg = LoadConfig::from_env();
    let pg = start_pg().await;
    let redis = start_redis().await;
    let ch = ch_backend(&cfg, cfg.instances_per_rule).await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    // Seed rules (distinct SQL unless coalesce forced).
    let mut rule_ids = Vec::with_capacity(cfg.rules);
    for i in 0..cfg.rules {
        let spec = RuleSpec {
            sql: rule_sql(i, cfg.coalesce),
            interval_secs: 30,
            for_secs: 0,
            label_columns: vec!["svc".into()],
            value_column: Some("val".into()),
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            resolve_after: 1,
        };
        let rule = pg.store.create_rule(tenant.clone(), &spec).await.unwrap();
        rule_ids.push(rule.id);
    }

    let queue: Arc<dyn Queue> = Arc::new(RedisQueue::connect(&redis.url).await.unwrap());

    // Warm-up pass (discarded): creates the instances + warms the health maps.
    let warm_ts = OffsetDateTime::now_utc();
    run_pass(
        &pg.store,
        ch.querier.clone(),
        &queue,
        cfg.eval_workers,
        &tenant,
        &rule_ids,
        warm_ts,
    )
    .await;

    // Measured pass: distinct eval_ts so try_claim_eval doesn't dedupe against warm-up.
    let meas_ts = warm_ts + time::Duration::seconds(60);
    let elapsed = run_pass(
        &pg.store,
        ch.querier.clone(),
        &queue,
        cfg.eval_workers,
        &tenant,
        &rule_ids,
        meas_ts,
    )
    .await;

    // Correctness gate: a sampled rule has its instances persisted.
    let sample = pg.store.load_instances(rule_ids[0]).await.unwrap();
    assert_eq!(
        sample.len(),
        cfg.instances_per_rule,
        "evaluator persisted instances"
    );

    report(
        "evaluator",
        &[
            ("CH backend", format!("{:?}", cfg.ch)),
            ("coalesce", cfg.coalesce.to_string()),
            ("rules", cfg.rules.to_string()),
            ("instances/rule", cfg.instances_per_rule.to_string()),
            ("workers", cfg.eval_workers.to_string()),
            ("wall", format!("{:.3}s", elapsed.as_secs_f64())),
            ("rules/sec", format!("{:.0}", per_sec(cfg.rules, elapsed))),
            (
                "evaluations/sec",
                format!("{:.0}", per_sec(cfg.rules * cfg.instances_per_rule, elapsed)),
            ),
        ],
    );
}
```

> Note: the import `cc_queue::RowQuerierArc` above is a placeholder if such an alias exists; if not, drop it — `Arc<dyn cc_clickhouse::RowQuerier>` is used directly. Remove any unused import to satisfy clippy.

- [ ] **Step 3: Verify it compiles**

Run: `cargo test --release --test load_evaluator --no-run`
Expected: compiles clean (fix imports if clippy/compiler flags unused ones).

- [ ] **Step 4: Verify clippy is clean**

Run: `cargo clippy --test load_evaluator -- -D warnings`
Expected: no warnings.

- [ ] **Step 5 (controller, Docker): run it**

Run: `cargo test --release --test load_evaluator -- --ignored --nocapture`
Expected: PASS; report prints `rules/sec` and `evaluations/sec`. For a quick check use a smaller workload: `CC_LOAD_RULES=200 cargo test --release --test load_evaluator -- --ignored --nocapture`.

- [ ] **Step 6: Commit**

```bash
git add tests/common/mod.rs tests/load_evaluator.rs
git commit -m "Add evaluator throughput load test (rules/sec, evaluations/sec)"
```

---

## Task 5: Dispatcher seed + stub webhooks + ingest test (events/sec)

**Files:**
- Modify: `tests/common/mod.rs` (dispatch seed + stub webhooks + event builder)
- Create: `tests/load_dispatcher.rs`

- [ ] **Step 1: Add dispatch helpers to `tests/common/mod.rs`**

Add imports:

```rust
use cc_domain::ids::{InstanceKey, RuleId};
use cc_domain::receiver::ChannelConfig;
use cc_domain::routing::{MatchOp, Matcher};
use cc_domain::rule::Severity;
use cc_domain::{EventKind, EventStatus};
use std::sync::atomic::{AtomicUsize, Ordering};
```

Add helpers:

```rust
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

/// Seed a tenant with a webhook receiver, an all-matching route (group_by=["svc"],
/// group_wait=0 so groups are immediately due), a non-matching active silence, and an
/// inhibition rule. Returns the tenant id.
pub async fn seed_dispatch_tenant(
    store: &PgStore,
    cipher: &dyn SecretCipher,
    webhook_url: &str,
) -> TenantId {
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_receiver(
            cipher,
            tenant.clone(),
            "ops",
            &ChannelConfig::Webhook {
                url: webhook_url.to_string(),
            },
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
            Some(&["svc".to_string()]),
            Some(0), // group_wait_secs = 0 → immediately due
            Some(0), // group_interval_secs = 0
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
            &["instance".to_string()],
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
        instance_key: InstanceKey::new(rule, &labels),
        status: EventStatus::Firing,
        kind: EventKind::Alert,
        labels,
        value: Some(1.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

/// An instant webhook that returns 200 and counts hits. Returns (url, counter, task).
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
```

> Note: confirm `create_route`'s `group_by` parameter type is `Option<&[String]>` (per the store signature) and pass `Some(&["svc".to_string()])` accordingly; adjust the borrow if the signature differs.

- [ ] **Step 2: Create `tests/load_dispatcher.rs` with the ingest test**

```rust
mod common;
use common::*;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use cc_dispatcher::cache::FilterCache;
use cc_dispatcher::{process_event, Notifiers, WebhookNotifier};
use cc_domain::ids::RuleId;
use cc_queue::event_bus::RedisEventBus;
use cc_queue::groups::{GroupStore, RedisGroups};
use cc_queue::EventBus;
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread")]
#[ignore = "load harness; needs Docker. Run: cargo test --release --test load_dispatcher -- --ignored --nocapture"]
async fn load_dispatcher_ingest_throughput() {
    let cfg = LoadConfig::from_env();
    let pg = start_pg().await;
    let redis = start_redis().await;
    let cipher = test_cipher();
    let (hook_url, _count, _hook) = start_counting_webhook().await;
    let tenant = seed_dispatch_tenant(&pg.store, cipher.as_ref(), &hook_url).await;

    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis.url).await.unwrap());
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis.url).await.unwrap());
    let cache = Arc::new(FilterCache::new(pg.store.clone(), cipher.clone()));
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);
    let rule = RuleId(Uuid::new_v4());

    // Publish E events (untimed).
    for i in 0..cfg.events {
        bus.publish(&make_event(&tenant, rule, i)).await.unwrap();
    }

    // Drain with bounded workers calling the real process_event; time the drain.
    let processed = Arc::new(AtomicUsize::new(0));
    let t0 = Instant::now();
    let mut handles = Vec::new();
    for w in 0..cfg.dispatch_workers {
        let (store, bus, groups, cache, notifiers, cipher, processed) = (
            pg.store.clone(),
            bus.clone(),
            groups.clone(),
            cache.clone(),
            notifiers.clone(),
            cipher.clone(),
            processed.clone(),
        );
        let total = cfg.events;
        handles.push(tokio::spawn(async move {
            let consumer = format!("disp-w{w}");
            loop {
                if processed.load(Ordering::Relaxed) >= total {
                    break;
                }
                let entries = bus.consume(&consumer, 16, 100).await.unwrap();
                if entries.is_empty() {
                    if processed.load(Ordering::Relaxed) >= total {
                        break;
                    }
                    continue;
                }
                let n = entries.len();
                for e in &entries {
                    let ack = process_event(
                        &store,
                        bus.as_ref(),
                        &notifiers,
                        groups.as_ref(),
                        &cache,
                        cipher.as_ref(),
                        e,
                    )
                    .await;
                    if ack {
                        bus.ack(&e.id).await.unwrap();
                    }
                }
                processed.fetch_add(n, Ordering::Relaxed);
            }
        }));
    }
    for h in handles {
        h.await.unwrap();
    }
    let elapsed = t0.elapsed();

    assert_eq!(
        processed.load(Ordering::Relaxed),
        cfg.events,
        "all events processed"
    );

    report(
        "dispatcher-ingest",
        &[
            ("events", cfg.events.to_string()),
            ("workers", cfg.dispatch_workers.to_string()),
            ("wall", format!("{:.3}s", elapsed.as_secs_f64())),
            ("events/sec", format!("{:.0}", per_sec(cfg.events, elapsed))),
        ],
    );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo test --release --test load_dispatcher --no-run`
Expected: compiles clean.

- [ ] **Step 4: Verify clippy is clean**

Run: `cargo clippy --test load_dispatcher -- -D warnings`
Expected: no warnings.

- [ ] **Step 5 (controller, Docker): run it**

Run: `CC_LOAD_EVENTS=5000 cargo test --release --test load_dispatcher load_dispatcher_ingest_throughput -- --ignored --nocapture`
Expected: PASS; report prints `events/sec`.

- [ ] **Step 6: Commit**

```bash
git add tests/common/mod.rs tests/load_dispatcher.rs
git commit -m "Add dispatcher ingest throughput load test (events/sec)"
```

---

## Task 6: Dispatcher flush test (deliveries/sec)

**Files:**
- Modify: `tests/load_dispatcher.rs` (add the flush test + a shared buffer helper)

- [ ] **Step 1: Add the flush test to `tests/load_dispatcher.rs`**

Append this test (and a small buffer helper) to the file. Reuse the same imports plus `cc_dispatcher::flush_group`.

```rust
use cc_dispatcher::flush_group;

/// Buffer E events into Redis groups via the real process_event (untimed setup for flush).
async fn buffer_events(
    store: &cc_stores::PgStore,
    bus: &Arc<dyn EventBus>,
    groups: &Arc<dyn GroupStore>,
    cache: &Arc<FilterCache>,
    notifiers: &Arc<Notifiers>,
    cipher: &Arc<dyn cc_crypto::SecretCipher>,
    tenant: &cc_domain::ids::TenantId,
    rule: RuleId,
    events: usize,
    workers: usize,
) {
    for i in 0..events {
        bus.publish(&make_event(tenant, rule, i)).await.unwrap();
    }
    let processed = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();
    for w in 0..workers {
        let (store, bus, groups, cache, notifiers, cipher, processed) = (
            store.clone(),
            bus.clone(),
            groups.clone(),
            cache.clone(),
            notifiers.clone(),
            cipher.clone(),
            processed.clone(),
        );
        handles.push(tokio::spawn(async move {
            let consumer = format!("buf-w{w}");
            loop {
                if processed.load(Ordering::Relaxed) >= events {
                    break;
                }
                let entries = bus.consume(&consumer, 16, 100).await.unwrap();
                if entries.is_empty() {
                    if processed.load(Ordering::Relaxed) >= events {
                        break;
                    }
                    continue;
                }
                let n = entries.len();
                for e in &entries {
                    let ack = process_event(
                        &store,
                        bus.as_ref(),
                        &notifiers,
                        groups.as_ref(),
                        &cache,
                        cipher.as_ref(),
                        e,
                    )
                    .await;
                    if ack {
                        bus.ack(&e.id).await.unwrap();
                    }
                }
                processed.fetch_add(n, Ordering::Relaxed);
            }
        }));
    }
    for h in handles {
        h.await.unwrap();
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "load harness; needs Docker. Run: cargo test --release --test load_dispatcher -- --ignored --nocapture"]
async fn load_dispatcher_flush_throughput() {
    let cfg = LoadConfig::from_env();
    let pg = start_pg().await;
    let redis = start_redis().await;
    let cipher = test_cipher();
    let (hook_url, count, _hook) = start_counting_webhook().await;
    let tenant = seed_dispatch_tenant(&pg.store, cipher.as_ref(), &hook_url).await;

    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis.url).await.unwrap());
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis.url).await.unwrap());
    let cache = Arc::new(FilterCache::new(pg.store.clone(), cipher.clone()));
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);
    let rule = RuleId(Uuid::new_v4());

    // Setup (untimed): buffer events into groups.
    buffer_events(
        &pg.store,
        &bus,
        &groups,
        &cache,
        &notifiers,
        &cipher,
        &tenant,
        rule,
        cfg.events,
        cfg.dispatch_workers,
    )
    .await;

    // Measured: flush all due groups with bounded workers calling the real flush_group.
    let flushed = Arc::new(AtomicUsize::new(0));
    let t0 = Instant::now();
    let mut handles = Vec::new();
    for _ in 0..cfg.dispatch_workers {
        let (store, bus, groups, notifiers, cipher, flushed) = (
            pg.store.clone(),
            bus.clone(),
            groups.clone(),
            notifiers.clone(),
            cipher.clone(),
            flushed.clone(),
        );
        handles.push(tokio::spawn(async move {
            loop {
                let ids = groups.claim_due(now_ms(), 32).await.unwrap();
                if ids.is_empty() {
                    break;
                }
                for gid in ids {
                    flush_group(
                        &store,
                        bus.as_ref(),
                        &notifiers,
                        groups.as_ref(),
                        cipher.as_ref(),
                        &gid,
                    )
                    .await;
                    flushed.fetch_add(1, Ordering::Relaxed);
                }
            }
        }));
    }
    for h in handles {
        h.await.unwrap();
    }
    let elapsed = t0.elapsed();

    let groups_flushed = flushed.load(Ordering::Relaxed);
    let deliveries = count.load(Ordering::Relaxed);
    assert!(groups_flushed > 0, "at least one group flushed");
    assert!(deliveries > 0, "at least one delivery made");

    report(
        "dispatcher-flush",
        &[
            ("events buffered", cfg.events.to_string()),
            ("groups flushed", groups_flushed.to_string()),
            ("deliveries", deliveries.to_string()),
            ("workers", cfg.dispatch_workers.to_string()),
            ("wall", format!("{:.3}s", elapsed.as_secs_f64())),
            ("deliveries/sec", format!("{:.0}", per_sec(deliveries, elapsed))),
            ("groups/sec", format!("{:.0}", per_sec(groups_flushed, elapsed))),
        ],
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo test --release --test load_dispatcher --no-run`
Expected: compiles clean.

- [ ] **Step 3: Verify clippy is clean**

Run: `cargo clippy --test load_dispatcher -- -D warnings`
Expected: no warnings.

- [ ] **Step 4 (controller, Docker): run it**

Run: `CC_LOAD_EVENTS=5000 cargo test --release --test load_dispatcher load_dispatcher_flush_throughput -- --ignored --nocapture`
Expected: PASS; report prints `deliveries/sec` and `groups/sec`, with `deliveries` ≈ number of distinct svc groups (≤ `GROUP_CARDINALITY`).

- [ ] **Step 5: Commit**

```bash
git add tests/load_dispatcher.rs
git commit -m "Add dispatcher flush throughput load test (deliveries/sec)"
```

---

## Task 7: Documentation

**Files:**
- Create: `docs/load-testing.md`

- [ ] **Step 1: Write `docs/load-testing.md`**

```markdown
# Load / throughput testing

These are `#[ignore]`d integration tests under `tests/` that measure sustained throughput
over real Postgres + Redis (testcontainers). They never run in normal CI; run them on
demand. Docker is required.

## Run

```
cargo test --release --test load_evaluator  -- --ignored --nocapture
cargo test --release --test load_dispatcher -- --ignored --nocapture
```

## Knobs (env vars)

| Var | Default | Meaning |
|---|---|---|
| `CC_LOAD_RULES` | 2000 | rules seeded / eval jobs per pass |
| `CC_LOAD_INSTANCES_PER_RULE` | 20 | rows returned per query |
| `CC_LOAD_EVAL_WORKERS` | 8 | evaluator worker tasks |
| `CC_LOAD_EVENTS` | 50000 | events for the dispatcher stages |
| `CC_LOAD_DISPATCH_WORKERS` | 8 | dispatcher / flusher worker tasks |
| `CC_LOAD_CH` | `stub` | `stub` (instant Axum) or `real` (ClickHouse container) |
| `CC_LOAD_COALESCE` | `0` | `1` forces identical SQL to measure the full-coalescing best case |

## What each number means

- **evaluator** → `rules/sec`, `evaluations/sec`: the evaluator hot loop + its Postgres/Redis
  I/O (claim, get_rule, coalesced CH query, load_instances, upsert). `NoopBus` isolates it
  from event publish.
- **dispatcher-ingest** → `events/sec`: consume → route → group-buffer into Redis.
- **dispatcher-flush** → `deliveries/sec`, `groups/sec`: claim_due → take_group → decrypt →
  PG dedup → mark_sent, with an instant webhook (network time factored out).

The `stub` CH backend and instant webhook isolate clickety-clack's own orchestration cost
from third-party server/network time — that is the headline. `CC_LOAD_CH=real` is a
cross-check. All numbers are machine/container-dependent (testcontainer defaults).
```

- [ ] **Step 2: Commit**

```bash
git add docs/load-testing.md
git commit -m "Document the load/throughput harness"
```

---

## Plan self-review

**Spec coverage:**
- §3 both CH backends → Task 3 (stub + real). ✓
- §3 ignored integration tests + report → all test tasks, `report()` in Task 2. ✓
- §4 evaluator rules/sec + evaluations/sec, distinct SQL, NoopBus, persistent health map → Task 4. ✓
- §5a events/sec (ingest→route→group) → Task 5. ✓
- §5b deliveries/sec (flush, instant webhook) → Task 6. ✓
- §6 knobs incl. `CC_LOAD_COALESCE`, group_wait=0 → `LoadConfig` (Task 2), `seed_dispatch_tenant` (Task 5). ✓
- §7 correctness gates (assert completion / instances persisted) → Tasks 4–6. ✓
- §9 file structure → matches the table. ✓

**Open items to confirm during implementation (flagged inline in the tasks):**
- Exact `EventBus` trait method set + `TailCursor`/`QueueError` paths for `NoopBus` (Task 4 Step 1).
- `create_route` `group_by` parameter borrow type (Task 5 Step 1).
- Drop the speculative `cc_queue::RowQuerierArc` import if no such alias exists (Task 4 Step 2).
- `GenericImage` builder method names in testcontainers 0.23 (Task 3) — the plan uses only `new` + `with_exposed_port` + `start` + a code-side `/ping` poll to stay version-robust.

**Type consistency:** `LoadConfig`, `ChHandle.querier`, `rule_sql`, `make_event`, `seed_dispatch_tenant`, `start_counting_webhook`, `now_ms`, `per_sec`, `report` are defined once in `common` and referenced consistently across test files. Worker-loop shape (consume → process → ack → count, stop at total) is identical across evaluator/ingest/buffer drivers.
