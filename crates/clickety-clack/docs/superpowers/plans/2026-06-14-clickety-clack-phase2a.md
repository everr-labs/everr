# clickety-clack Phase 2a Implementation Plan — Dispatch Backbone

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move firing/resolved event delivery off the evaluator's inline pusher onto a durable Redis **event stream**, consumed by a new standalone **cc-dispatcher** role that delivers to per-tenant webhooks behind a `Notifier` trait, with deduplication, retry/backoff, a dead-letter stream, and a durable Postgres notification log; and feed the API's SSE stream from the same event stream so it works across processes.

**Architecture:** The evaluator publishes each `Event` to a Redis stream (`cc:events`) instead of delivering it directly. A horizontally-scalable `cc-dispatcher` role consumes that stream via a shared consumer group, and for each event delivers to the tenant's registered webhook subscriptions through a `Notifier` abstraction — guarded by a notification log (`dedup_key`) for at-least-once-with-dedup, with bounded exponential backoff and a dead-letter stream for permanent failures. The API role runs a per-replica "SSE pump" that tails the same stream (fan-out, no consumer group) and rebroadcasts into its in-process `events_tx`, so SSE clients on any API replica see events regardless of which process produced them.

**Tech Stack:** Rust 2021, `tokio`, `redis` (Streams), `sqlx` (Postgres), `reqwest`, `async-trait`, `sha2`/`hex`, `serde`, `proptest`, `testcontainers`. Builds directly on the Phase 1 crates already merged to `main`.

---

## Context: Phase 1 contracts this builds on

Already on `main` (do not redefine — import):
- `cc_domain::Event { tenant: TenantId, rule: RuleId, instance_key: InstanceKey, status: EventStatus, labels: BTreeMap<String,String>, value: Option<f64>, severity, annotations, eval_ts: OffsetDateTime }`; `EventStatus { Firing, Resolved }` (serde lowercase).
- `cc_domain::ids::{TenantId(Uuid), RuleId(Uuid), InstanceKey(String)}`; `cc_domain::Subscription { id: Uuid, tenant, webhook_url: String }`.
- `cc_queue`: `Queue` trait + `EvalJob` + `redis_streams::RedisQueue` (eval-jobs stream `cc:eval:jobs`, group `evaluators`). `QueueError { Redis, Json }`.
- `cc_stores::PgStore` with `subscriptions_for(tenant) -> Result<Vec<Subscription>, StoreError>`, `connect`, `migrate` (runs `migrations/`), plus rule/instance methods. `StoreError { Sqlx, Json, Migrate }`.
- `cc_evaluator`: `run_evaluator(consumer, store, queue, ch, pusher: Pusher, shutdown)` and `pusher::Pusher` (currently does in-process `events_tx` broadcast + per-tenant webhook POST). **Phase 2a replaces the Pusher.**
- `cc_api::AppState { store, ch, auth, events_tx: broadcast::Sender<Event> }`; SSE handler `subscriptions::stream` already reads `events_tx.subscribe()` filtered by tenant.
- Binary `src/main.rs`: role-selectable (`api`/`scheduler`/`evaluator`/`all`); builds `events_tx` broadcast and passes it to both the API `AppState` and the evaluator `Pusher`.

## Scope

**In scope (Phase 2a):**
- `cc-queue`: an `EventBus` trait + `RedisEventBus` (publish / consume-group / ack / tail-for-SSE / dead-letter) over stream `cc:events`.
- `migrations/0002_notifications.sql` + `cc-stores` notification-log methods.
- `cc-dispatcher` crate: pure `dedup_key`, `Notifier` trait + `WebhookNotifier`, pure `backoff_delay`, and the `run_dispatcher` consume→deliver loop.
- `cc-evaluator`: publish events to the `EventBus` instead of the inline pusher (delete `Pusher`).
- `cc-api`: an SSE pump task that tails the `EventBus` and rebroadcasts into `events_tx`.
- Binary wiring: new `dispatcher` role; evaluator takes `Arc<dyn EventBus>`; API spawns the SSE pump.
- Docker-backed integration + e2e tests; workspace fmt/clippy gate.

**Out of scope (Phase 2b, separate plan):** routing tree + receivers CRUD; grouping with `group_wait`/`group_interval` timers; Slack / email-SMTP / PagerDuty channels. The `Notifier` trait is designed in 2a so 2b only adds new impls.

**Deliberate Phase 2a simplifications (documented, not defects):**
- Delivery model is the Phase 1 firehose: each event is delivered to each of the tenant's `subscriptions` webhooks (no grouping). Grouping/routing is 2b.
- `try_begin_notification` inserts a `pending` row and returns false if a row already exists (sent OR pending). A row left `pending` by a dispatcher crash mid-send blocks redelivery of that exact event to that target. This is a rare missed-delivery window; Phase 3 adds a stale-`pending` reconciliation sweep. Documented in code.
- `backoff_delay` has no random jitter (kept deterministic for tests). Jitter is a 2b/3 refinement.

---

## File Structure

```
clickety-clack/
├── migrations/
│   └── 0002_notifications.sql        # NEW: notifications (notification log)
├── crates/
│   ├── queue/src/
│   │   ├── lib.rs                     # MODIFY: add EventBus trait + EventEntry + publish/tail/dead_letter
│   │   └── event_bus.rs              # NEW: RedisEventBus impl over cc:events
│   ├── stores/src/
│   │   └── pg.rs                      # MODIFY: notification-log methods
│   ├── evaluator/src/
│   │   ├── lib.rs                     # MODIFY: run_evaluator takes Arc<dyn EventBus>, publishes events
│   │   └── pusher.rs                 # DELETE
│   ├── api/src/
│   │   ├── lib.rs                     # MODIFY: add spawn_sse_pump
│   │   └── sse_pump.rs               # NEW: tails EventBus -> events_tx
│   └── dispatcher/                    # NEW crate: cc-dispatcher
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                 # run_dispatcher loop
│           ├── dedup.rs               # pure dedup_key + tests
│           ├── notify.rs              # Notifier trait + WebhookNotifier
│           └── retry.rs               # pure backoff_delay + deliver_with_retry
├── src/main.rs                        # MODIFY: dispatcher role, evaluator EventBus, api SSE pump
└── tests/
    └── e2e_dispatch.rs                # NEW: fire -> dispatcher webhook + notification log + dedup
```

## Conventions (same as Phase 1)

- TDD: failing test → red → implement → green → commit. Bite-sized steps.
- Conventional commits; **no Claude/AI attribution anywhere** (no `Co-Authored-By`, no "Generated with", no mention of Claude/Anthropic/AI in messages, code, or comments).
- Run from repo root. Docker-backed tests are marked; Docker is available.
- After each task: `cargo clippy --all-targets -- -D warnings` clean and `cargo fmt --all`.

---

### Task 0: EventBus trait + RedisEventBus (`cc-queue`)

**Files:**
- Modify: `crates/queue/src/lib.rs`
- Create: `crates/queue/src/event_bus.rs`
- Create: `crates/queue/tests/event_bus_it.rs`

- [ ] **Step 1: Add the EventBus trait and types to `lib.rs`.**

Add to the TOP of `crates/queue/src/lib.rs` (after the existing `pub mod redis_streams;`):

```rust
pub mod event_bus;
```

Add these imports/types to `crates/queue/src/lib.rs` (the `use` for `cc_domain::Event` and the new items). Append after the existing `Queue` trait:

```rust
use cc_domain::Event;

/// One event read from the event stream (consume-group or tail).
#[derive(Debug, Clone, PartialEq)]
pub struct EventEntry {
    pub id: String,
    pub event: Event,
}

/// Transport for firing/resolved events: evaluator publishes, dispatcher consumes
/// (shared group), api tails (fan-out) for SSE. Redis Streams now, Kafka later.
#[async_trait]
pub trait EventBus: Send + Sync {
    /// Publish one event to the stream.
    async fn publish(&self, ev: &Event) -> Result<(), QueueError>;
    /// Consume via the shared "dispatchers" group (at-least-once). Ack with `ack`.
    async fn consume(
        &self,
        consumer: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError>;
    async fn ack(&self, id: &str) -> Result<(), QueueError>;
    /// Fan-out tail for SSE: read entries strictly after `last_id` (use "$" to start
    /// at the live tail). Returns entries in order; the caller advances its own cursor
    /// using the last returned `id`. No consumer group — every caller sees every event.
    async fn tail(
        &self,
        last_id: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError>;
    /// Record a permanently-undeliverable event on the dead-letter stream.
    async fn dead_letter(&self, ev: &Event, reason: &str) -> Result<(), QueueError>;
}
```

- [ ] **Step 2: Write the failing integration test** — `crates/queue/tests/event_bus_it.rs`:

```rust
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::rule::Severity;
use cc_queue::event_bus::RedisEventBus;
use cc_queue::EventBus;
use std::collections::BTreeMap;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

fn ev() -> Event {
    Event {
        tenant: TenantId(Uuid::nil()),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("k".into()),
        status: EventStatus::Firing,
        labels: BTreeMap::new(),
        value: Some(1.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

#[tokio::test]
async fn publish_consume_ack_and_tail() {
    let node = Redis::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    let url = format!("redis://127.0.0.1:{port}");

    let bus = RedisEventBus::connect(&url).await.unwrap();

    // consume-group path
    bus.publish(&ev()).await.unwrap();
    let got = bus.consume("d1", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].event, ev());
    bus.ack(&got[0].id).await.unwrap();

    // dead-letter path doesn't error
    bus.dead_letter(&ev(), "boom").await.unwrap();
}

#[tokio::test]
async fn tail_reads_only_new_after_cursor() {
    let node = Redis::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    let url = format!("redis://127.0.0.1:{port}");
    let bus = RedisEventBus::connect(&url).await.unwrap();

    // Start the cursor at the live tail, then publish, then tail sees it.
    let mut cursor = "$".to_string();
    bus.publish(&ev()).await.unwrap();
    let entries = bus.tail(&cursor, 10, 1000).await.unwrap();
    assert_eq!(entries.len(), 1);
    cursor = entries.last().unwrap().id.clone();

    // No new publishes -> tail returns empty within the block window.
    let none = bus.tail(&cursor, 10, 300).await.unwrap();
    assert!(none.is_empty());
}
```

- [ ] **Step 3: Run red** — `cargo test -p cc-queue --test event_bus_it` should FAIL to compile (`RedisEventBus` missing).

- [ ] **Step 4: Implement** — `crates/queue/src/event_bus.rs`:

```rust
use crate::{EventBus, EventEntry, QueueError};
use async_trait::async_trait;
use cc_domain::Event;
use redis::aio::ConnectionManager;
use redis::streams::{StreamReadOptions, StreamReadReply};
use redis::AsyncCommands;

const STREAM: &str = "cc:events";
const GROUP: &str = "dispatchers";
const DEADLETTER: &str = "cc:events:deadletter";

pub struct RedisEventBus {
    conn: ConnectionManager,
}

impl RedisEventBus {
    /// Connect and ensure the dispatcher consumer group exists (idempotent).
    pub async fn connect(url: &str) -> Result<Self, QueueError> {
        let client = redis::Client::open(url)?;
        let mut conn = ConnectionManager::new(client).await?;
        let _: Result<(), redis::RedisError> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(STREAM)
            .arg(GROUP)
            .arg("$")
            .arg("MKSTREAM")
            .query_async(&mut conn)
            .await;
        Ok(Self { conn })
    }

    fn parse_entries(reply: StreamReadReply) -> Result<Vec<EventEntry>, QueueError> {
        let mut out = Vec::new();
        for key in reply.keys {
            for entry in key.ids {
                if let Some(redis::Value::BulkString(bytes)) = entry.map.get("event") {
                    let event: Event = serde_json::from_slice(bytes)?;
                    out.push(EventEntry { id: entry.id, event });
                }
            }
        }
        Ok(out)
    }
}

#[async_trait]
impl EventBus for RedisEventBus {
    async fn publish(&self, ev: &Event) -> Result<(), QueueError> {
        let payload = serde_json::to_string(ev)?;
        let mut conn = self.conn.clone();
        let _: String = conn.xadd(STREAM, "*", &[("event", payload)]).await?;
        Ok(())
    }

    async fn consume(
        &self,
        consumer: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        let mut conn = self.conn.clone();
        let opts = StreamReadOptions::default()
            .group(GROUP, consumer)
            .count(count)
            .block(block_ms);
        let reply: StreamReadReply = conn.xread_options(&[STREAM], &[">"], &opts).await?;
        Self::parse_entries(reply)
    }

    async fn ack(&self, id: &str) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(STREAM, GROUP, &[id]).await?;
        Ok(())
    }

    async fn tail(
        &self,
        last_id: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        let mut conn = self.conn.clone();
        // No group: plain XREAD from the caller's cursor. "$" means "only new from now".
        let opts = StreamReadOptions::default().count(count).block(block_ms);
        let reply: StreamReadReply = conn.xread_options(&[STREAM], &[last_id], &opts).await?;
        Self::parse_entries(reply)
    }

    async fn dead_letter(&self, ev: &Event, reason: &str) -> Result<(), QueueError> {
        let payload = serde_json::to_string(ev)?;
        let mut conn = self.conn.clone();
        let _: String = conn
            .xadd(DEADLETTER, "*", &[("event", payload), ("reason", reason.to_string())])
            .await?;
        Ok(())
    }
}
```

- [ ] **Step 5: Run green** — `cargo test -p cc-queue --test event_bus_it` (Docker). Expect 2 tests pass. Run `cargo clippy -p cc-queue --all-targets -- -D warnings`.

API NOTE: `redis::Value::BulkString` is correct for redis 0.27 (confirmed in Phase 1). `xread_options` with a non-`>` id on a plain (non-group) read tails from that id; `"$"` reads only entries added after the call begins.

- [ ] **Step 6: Commit** — `git add crates/queue && git commit -m "feat(queue): EventBus trait + Redis event stream (publish/consume/tail/dead-letter)"`

---

### Task 1: Notification log (`migrations` + `cc-stores`)

**Files:**
- Create: `migrations/0002_notifications.sql`
- Modify: `crates/stores/src/pg.rs`
- Create: `crates/stores/tests/notifications_it.rs`

- [ ] **Step 1: Migration** — `migrations/0002_notifications.sql`:

```sql
CREATE TABLE notifications (
    dedup_key   TEXT PRIMARY KEY,
    tenant      UUID NOT NULL,
    channel     TEXT NOT NULL,
    target      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | failed
    attempts    INT NOT NULL DEFAULT 0,
    last_error  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_tenant_idx ON notifications (tenant);
CREATE INDEX notifications_status_idx ON notifications (status);
```

- [ ] **Step 2: Add store methods** to `crates/stores/src/pg.rs` (inside `impl PgStore`, e.g. after the subscriptions section):

```rust
    // ---- notification log ----

    /// Begin a notification: insert a `pending` row keyed by `dedup_key`.
    /// Returns true if newly inserted (caller should attempt delivery); false if a
    /// row already exists (already sent, or pending/in-flight) — caller skips to
    /// avoid a duplicate send. NOTE: a row left `pending` by a crash mid-send blocks
    /// redelivery of that exact event to that target; Phase 3 adds a stale-pending sweep.
    pub async fn try_begin_notification(
        &self,
        dedup_key: &str,
        tenant: TenantId,
        channel: &str,
        target: &str,
    ) -> Result<bool, StoreError> {
        let res = sqlx::query(
            "INSERT INTO notifications (dedup_key, tenant, channel, target)
             VALUES ($1,$2,$3,$4) ON CONFLICT (dedup_key) DO NOTHING",
        )
        .bind(dedup_key)
        .bind(tenant.0)
        .bind(channel)
        .bind(target)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    pub async fn mark_notification_sent(
        &self,
        dedup_key: &str,
        attempts: u32,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "UPDATE notifications SET status='sent', attempts=$2, updated_at=now()
             WHERE dedup_key=$1",
        )
        .bind(dedup_key)
        .bind(attempts as i32)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mark_notification_failed(
        &self,
        dedup_key: &str,
        attempts: u32,
        error: &str,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "UPDATE notifications SET status='failed', attempts=$2, last_error=$3, updated_at=now()
             WHERE dedup_key=$1",
        )
        .bind(dedup_key)
        .bind(attempts as i32)
        .bind(error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Test/inspection helper: fetch (status, attempts) for a dedup_key.
    pub async fn notification_status(
        &self,
        dedup_key: &str,
    ) -> Result<Option<(String, i32)>, StoreError> {
        let row = sqlx::query("SELECT status, attempts FROM notifications WHERE dedup_key=$1")
            .bind(dedup_key)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| (r.get::<String, _>("status"), r.get::<i32, _>("attempts"))))
    }
```

(`use sqlx::Row;` is already imported in `pg.rs`.)

- [ ] **Step 3: Integration test** — `crates/stores/tests/notifications_it.rs`:

```rust
use cc_domain::ids::TenantId;
use cc_stores::PgStore;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use uuid::Uuid;

#[tokio::test]
async fn notification_dedup_and_status() {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();

    let tenant = TenantId(Uuid::new_v4());
    let key = "k1";

    // First begin succeeds; second is a no-op (dedup).
    assert!(store.try_begin_notification(key, tenant, "webhook", "http://x").await.unwrap());
    assert!(!store.try_begin_notification(key, tenant, "webhook", "http://x").await.unwrap());

    assert_eq!(store.notification_status(key).await.unwrap(), Some(("pending".into(), 0)));
    store.mark_notification_sent(key, 2).await.unwrap();
    assert_eq!(store.notification_status(key).await.unwrap(), Some(("sent".into(), 2)));

    let key2 = "k2";
    assert!(store.try_begin_notification(key2, tenant, "webhook", "http://y").await.unwrap());
    store.mark_notification_failed(key2, 3, "boom").await.unwrap();
    assert_eq!(store.notification_status(key2).await.unwrap(), Some(("failed".into(), 3)));
}
```

- [ ] **Step 4: Run green** — `cargo test -p cc-stores --test notifications_it` (Docker). Run `cargo clippy -p cc-stores --all-targets -- -D warnings`.

- [ ] **Step 5: Commit** — `git add crates/stores migrations && git commit -m "feat(stores): notification log with dedup_key begin/sent/failed"`

---

### Task 2: Pure dedup key (`cc-dispatcher` crate scaffold + `dedup.rs`)

**Files:**
- Create: `crates/dispatcher/Cargo.toml`
- Create: `crates/dispatcher/src/lib.rs`
- Create: `crates/dispatcher/src/dedup.rs`

- [ ] **Step 1: Manifest** — `crates/dispatcher/Cargo.toml`:

```toml
[package]
name = "cc-dispatcher"
version = "0.1.0"
edition.workspace = true

[dependencies]
cc-domain = { path = "../domain" }
cc-stores = { path = "../stores" }
cc-queue = { path = "../queue" }
tokio.workspace = true
tracing.workspace = true
time.workspace = true
reqwest.workspace = true
serde_json.workspace = true
async-trait = "0.1"
thiserror.workspace = true
sha2 = "0.10"
hex = "0.4"

[dev-dependencies]
axum.workspace = true
uuid.workspace = true
testcontainers.workspace = true
testcontainers-modules.workspace = true
```

Add `"crates/dispatcher"` to root `Cargo.toml` `members`.

- [ ] **Step 2: dedup.rs with failing tests** — `crates/dispatcher/src/dedup.rs`:

```rust
use cc_domain::Event;

/// Stable dedup key for "this exact event delivered to this target".
/// Identical for redeliveries of the same firing/resolved transition to the same
/// target (same tenant+target+instance+status+eval_ts), so at-least-once stream
/// redelivery never produces a duplicate notification. A later, distinct transition
/// (different eval_ts) yields a different key and is delivered.
pub fn dedup_key(target: &str, ev: &Event) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(ev.tenant.0.as_bytes());
    h.update(b"\x00");
    h.update(target.as_bytes());
    h.update(b"\x00");
    h.update(ev.instance_key.0.as_bytes());
    h.update(b"\x00");
    h.update(match ev.status {
        cc_domain::EventStatus::Firing => b"firing".as_slice(),
        cc_domain::EventStatus::Resolved => b"resolved".as_slice(),
    });
    h.update(b"\x00");
    // eval_ts as unix nanos for a stable, collision-free encoding.
    h.update(ev.eval_ts.unix_timestamp_nanos().to_be_bytes());
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::event::{Event, EventStatus};
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use cc_domain::rule::Severity;
    use std::collections::BTreeMap;
    use time::{Duration, OffsetDateTime};
    use uuid::Uuid;

    fn ev(status: EventStatus, ts: OffsetDateTime) -> Event {
        Event {
            tenant: TenantId(Uuid::nil()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey("k".into()),
            status,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: ts,
        }
    }

    fn t(s: i64) -> OffsetDateTime {
        OffsetDateTime::UNIX_EPOCH + Duration::seconds(s)
    }

    #[test]
    fn same_event_same_target_is_stable() {
        let a = dedup_key("http://x", &ev(EventStatus::Firing, t(0)));
        let b = dedup_key("http://x", &ev(EventStatus::Firing, t(0)));
        assert_eq!(a, b);
    }

    #[test]
    fn differs_by_target() {
        let a = dedup_key("http://x", &ev(EventStatus::Firing, t(0)));
        let b = dedup_key("http://y", &ev(EventStatus::Firing, t(0)));
        assert_ne!(a, b);
    }

    #[test]
    fn differs_by_status_and_time() {
        let fire = dedup_key("http://x", &ev(EventStatus::Firing, t(0)));
        let resolve = dedup_key("http://x", &ev(EventStatus::Resolved, t(0)));
        let later = dedup_key("http://x", &ev(EventStatus::Firing, t(60)));
        assert_ne!(fire, resolve);
        assert_ne!(fire, later);
    }
}
```

- [ ] **Step 3: lib.rs** — `crates/dispatcher/src/lib.rs`:

```rust
pub mod dedup;
pub use dedup::dedup_key;
```

- [ ] **Step 4:** Run `cargo test -p cc-dispatcher dedup` — expect 3 tests pass. `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`.

- [ ] **Step 5: Commit** — `git add crates/dispatcher Cargo.toml && git commit -m "feat(dispatcher): pure dedup_key for at-least-once-with-dedup"`

---

### Task 3: Notifier trait + WebhookNotifier (`notify.rs`)

**Files:**
- Create: `crates/dispatcher/src/notify.rs`
- Modify: `crates/dispatcher/src/lib.rs`
- Create: `crates/dispatcher/tests/webhook_it.rs`

- [ ] **Step 1: notify.rs** — `crates/dispatcher/src/notify.rs`:

```rust
use async_trait::async_trait;
use cc_domain::Event;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NotifyError {
    /// Worth retrying (timeout, connection error, 5xx).
    #[error("transient: {0}")]
    Transient(String),
    /// Not worth retrying (4xx, malformed target).
    #[error("permanent: {0}")]
    Permanent(String),
}

/// A delivery channel. Phase 2a ships only `WebhookNotifier`; Phase 2b adds Slack,
/// email, PagerDuty as additional impls behind this same trait.
#[async_trait]
pub trait Notifier: Send + Sync {
    fn channel(&self) -> &'static str;
    /// Deliver `ev` to `target`. Classify failures as Transient vs Permanent.
    async fn send(&self, target: &str, ev: &Event) -> Result<(), NotifyError>;
}

/// Generic webhook: POST the event as JSON. 2xx = ok, 4xx = permanent, else transient.
pub struct WebhookNotifier {
    http: reqwest::Client,
}

impl WebhookNotifier {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("building reqwest client with timeout should not fail"),
        }
    }
}

impl Default for WebhookNotifier {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Notifier for WebhookNotifier {
    fn channel(&self) -> &'static str {
        "webhook"
    }

    async fn send(&self, target: &str, ev: &Event) -> Result<(), NotifyError> {
        let resp = self
            .http
            .post(target)
            .json(ev)
            .send()
            .await
            .map_err(|e| NotifyError::Transient(e.to_string()))?;
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else if status.is_client_error() {
            Err(NotifyError::Permanent(format!("status {status}")))
        } else {
            Err(NotifyError::Transient(format!("status {status}")))
        }
    }
}
```

- [ ] **Step 2: Re-export** — update `crates/dispatcher/src/lib.rs`:

```rust
pub mod dedup;
pub mod notify;

pub use dedup::dedup_key;
pub use notify::{Notifier, NotifyError, WebhookNotifier};
```

- [ ] **Step 3: Integration-style test with a stub server** — `crates/dispatcher/tests/webhook_it.rs`:

```rust
use cc_dispatcher::notify::{Notifier, NotifyError, WebhookNotifier};
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::rule::Severity;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use uuid::Uuid;

fn ev() -> Event {
    Event {
        tenant: TenantId(Uuid::nil()),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("k".into()),
        status: EventStatus::Firing,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

async fn start_server(status: u16, captured: Arc<Mutex<usize>>) -> String {
    use axum::http::StatusCode;
    use axum::routing::post;
    use axum::Router;
    let code = StatusCode::from_u16(status).unwrap();
    let app = Router::new().route(
        "/hook",
        post(move || {
            let captured = captured.clone();
            async move {
                *captured.lock().unwrap() += 1;
                code
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok(); });
    format!("http://{addr}/hook")
}

#[tokio::test]
async fn webhook_2xx_is_ok() {
    let hits = Arc::new(Mutex::new(0));
    let url = start_server(200, hits.clone()).await;
    let n = WebhookNotifier::new();
    n.send(&url, &ev()).await.unwrap();
    assert_eq!(*hits.lock().unwrap(), 1);
}

#[tokio::test]
async fn webhook_4xx_is_permanent() {
    let hits = Arc::new(Mutex::new(0));
    let url = start_server(404, hits.clone()).await;
    let n = WebhookNotifier::new();
    let err = n.send(&url, &ev()).await.unwrap_err();
    assert!(matches!(err, NotifyError::Permanent(_)));
}

#[tokio::test]
async fn webhook_5xx_is_transient() {
    let hits = Arc::new(Mutex::new(0));
    let url = start_server(503, hits.clone()).await;
    let n = WebhookNotifier::new();
    let err = n.send(&url, &ev()).await.unwrap_err();
    assert!(matches!(err, NotifyError::Transient(_)));
}
```

- [ ] **Step 4:** Run `cargo test -p cc-dispatcher --test webhook_it` — expect 3 pass. `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`.

- [ ] **Step 5: Commit** — `git add crates/dispatcher && git commit -m "feat(dispatcher): Notifier trait + WebhookNotifier with transient/permanent classification"`

---

### Task 4: Backoff + retry (`retry.rs`)

**Files:**
- Create: `crates/dispatcher/src/retry.rs`
- Modify: `crates/dispatcher/src/lib.rs`

- [ ] **Step 1: retry.rs** — `crates/dispatcher/src/retry.rs`:

```rust
use crate::notify::{Notifier, NotifyError};
use cc_domain::Event;
use std::time::Duration;

/// Deterministic exponential backoff: base * 2^attempt, capped. No jitter (Phase 2a).
pub fn backoff_delay(attempt: u32, base_ms: u64, cap_ms: u64) -> Duration {
    let shifted = base_ms.checked_shl(attempt).unwrap_or(u64::MAX);
    Duration::from_millis(shifted.min(cap_ms))
}

/// Try delivery up to `max_attempts`. Retries only on Transient errors, sleeping
/// `backoff_delay` between attempts. Returns Ok(attempts_used) on success, or the
/// last error (Permanent stops immediately; Transient stops after max_attempts).
pub async fn deliver_with_retry(
    notifier: &dyn Notifier,
    target: &str,
    ev: &Event,
    max_attempts: u32,
) -> Result<u32, (u32, NotifyError)> {
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match notifier.send(target, ev).await {
            Ok(()) => return Ok(attempt),
            Err(NotifyError::Permanent(e)) => return Err((attempt, NotifyError::Permanent(e))),
            Err(NotifyError::Transient(e)) => {
                if attempt >= max_attempts {
                    return Err((attempt, NotifyError::Transient(e)));
                }
                tokio::time::sleep(backoff_delay(attempt, 50, 5_000)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notify::Notifier;
    use async_trait::async_trait;
    use cc_domain::event::{Event, EventStatus};
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use cc_domain::rule::Severity;
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev() -> Event {
        Event {
            tenant: TenantId(Uuid::nil()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey("k".into()),
            status: EventStatus::Firing,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff_delay(0, 50, 5_000), Duration::from_millis(50));
        assert_eq!(backoff_delay(1, 50, 5_000), Duration::from_millis(100));
        assert_eq!(backoff_delay(3, 50, 5_000), Duration::from_millis(400));
        assert_eq!(backoff_delay(20, 50, 5_000), Duration::from_millis(5_000)); // capped
    }

    struct Flaky {
        fail_first: u32,
        calls: AtomicU32,
    }
    #[async_trait]
    impl Notifier for Flaky {
        fn channel(&self) -> &'static str {
            "test"
        }
        async fn send(&self, _t: &str, _e: &Event) -> Result<(), NotifyError> {
            let n = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if n <= self.fail_first {
                Err(NotifyError::Transient("flaky".into()))
            } else {
                Ok(())
            }
        }
    }

    struct AlwaysPermanent;
    #[async_trait]
    impl Notifier for AlwaysPermanent {
        fn channel(&self) -> &'static str {
            "test"
        }
        async fn send(&self, _t: &str, _e: &Event) -> Result<(), NotifyError> {
            Err(NotifyError::Permanent("nope".into()))
        }
    }

    #[tokio::test]
    async fn retries_transient_then_succeeds() {
        let n = Flaky { fail_first: 2, calls: AtomicU32::new(0) };
        let attempts = deliver_with_retry(&n, "t", &ev(), 5).await.unwrap();
        assert_eq!(attempts, 3);
    }

    #[tokio::test]
    async fn permanent_stops_immediately() {
        let n = AlwaysPermanent;
        let (attempts, err) = deliver_with_retry(&n, "t", &ev(), 5).await.unwrap_err();
        assert_eq!(attempts, 1);
        assert!(matches!(err, NotifyError::Permanent(_)));
    }

    #[tokio::test]
    async fn transient_gives_up_after_max() {
        let n = Flaky { fail_first: 100, calls: AtomicU32::new(0) };
        let (attempts, err) = deliver_with_retry(&n, "t", &ev(), 3).await.unwrap_err();
        assert_eq!(attempts, 3);
        assert!(matches!(err, NotifyError::Transient(_)));
        let _ = Arc::new(()); // silence unused import if any
    }
}
```

- [ ] **Step 2: Re-export** — update `crates/dispatcher/src/lib.rs` to add:

```rust
pub mod retry;
pub use retry::{backoff_delay, deliver_with_retry};
```

(Full `lib.rs` now: `pub mod dedup; pub mod notify; pub mod retry;` plus the `pub use` lines for each.)

- [ ] **Step 3:** Run `cargo test -p cc-dispatcher retry` — expect 4 tests pass (1 unit + 3 async). `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`. (Remove the `let _ = Arc::new(())` line if clippy flags it; it's only there to avoid an unused-import warning — if `Arc` is unused, delete the `use ...Arc;` import instead.)

- [ ] **Step 4: Commit** — `git add crates/dispatcher && git commit -m "feat(dispatcher): deterministic backoff + transient-only retry"`

---

### Task 5: Dispatcher run loop (`run_dispatcher`)

**Files:**
- Modify: `crates/dispatcher/src/lib.rs`
- Create: `crates/dispatcher/tests/dispatch_it.rs`

- [ ] **Step 1: Add `run_dispatcher` + `process_event` to `lib.rs`.** Append to `crates/dispatcher/src/lib.rs`:

```rust
use cc_domain::Event;
use cc_queue::{EventBus, EventEntry};
use cc_stores::PgStore;
use notify::{Notifier, NotifyError};
use std::sync::Arc;
use std::time::Duration;

const MAX_ATTEMPTS: u32 = 4;

/// Run the dispatcher consume loop until `shutdown` flips true.
pub async fn run_dispatcher(
    consumer: String,
    store: PgStore,
    bus: Arc<dyn EventBus>,
    notifier: Arc<dyn Notifier>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        let entries = match bus.consume(&consumer, 16, 2000).await {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(error = %e, "event consume failed");
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {}
                    _ = shutdown.changed() => {}
                }
                continue;
            }
        };
        for entry in entries {
            process_event(&store, bus.as_ref(), notifier.as_ref(), &entry).await;
            if let Err(e) = bus.ack(&entry.id).await {
                tracing::error!(error = %e, "event ack failed");
            }
        }
    }
    tracing::info!("dispatcher stopped");
}

/// Deliver one event to every subscription for its tenant, deduped + retried, with
/// a notification-log row and dead-letter on permanent failure. Best-effort: never
/// returns an error (the stream entry is always acked; durability lives in the log
/// + dead-letter stream).
async fn process_event(
    store: &PgStore,
    bus: &dyn EventBus,
    notifier: &dyn Notifier,
    entry: &EventEntry,
) {
    let ev: &Event = &entry.event;
    let subs = match store.subscriptions_for(ev.tenant).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "loading subscriptions failed");
            return;
        }
    };
    for sub in subs {
        let key = dedup::dedup_key(&sub.webhook_url, ev);
        // Dedup gate: only the first claim of this (event,target) delivers.
        match store
            .try_begin_notification(&key, ev.tenant, notifier.channel(), &sub.webhook_url)
            .await
        {
            Ok(true) => {}
            Ok(false) => continue, // already delivered/in-flight
            Err(e) => {
                tracing::error!(error = %e, "begin notification failed");
                continue;
            }
        }
        match retry::deliver_with_retry(notifier, &sub.webhook_url, ev, MAX_ATTEMPTS).await {
            Ok(attempts) => {
                let _ = store.mark_notification_sent(&key, attempts).await;
            }
            Err((attempts, err)) => {
                let reason = match &err {
                    NotifyError::Transient(s) | NotifyError::Permanent(s) => s.clone(),
                };
                let _ = store.mark_notification_failed(&key, attempts, &reason).await;
                let _ = bus.dead_letter(ev, &reason).await;
                tracing::warn!(url = %sub.webhook_url, error = %err, "notification dead-lettered");
            }
        }
    }
}
```

(`lib.rs` keeps the earlier `pub mod`/`pub use` lines at the top.)

- [ ] **Step 2: Integration test** — `crates/dispatcher/tests/dispatch_it.rs`. Spins Postgres + Redis, publishes an event, runs one dispatcher iteration via `run_dispatcher` (with a shutdown), asserts the webhook was hit once and the notification row is `sent`; a second publish of the SAME event (same eval_ts) does NOT double-deliver.

```rust
use cc_dispatcher::dedup::dedup_key;
use cc_dispatcher::notify::WebhookNotifier;
use cc_dispatcher::{run_dispatcher, Notifier};
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::rule::Severity;
use cc_queue::event_bus::RedisEventBus;
use cc_queue::EventBus;
use cc_stores::PgStore;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

async fn start_webhook(hits: Arc<Mutex<usize>>) -> String {
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route(
        "/hook",
        post(move || {
            let hits = hits.clone();
            async move {
                *hits.lock().unwrap() += 1;
                "ok"
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok(); });
    format!("http://{addr}/hook")
}

fn ev(tenant: TenantId) -> Event {
    Event {
        tenant,
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("svc=api".into()),
        status: EventStatus::Firing,
        labels: BTreeMap::new(),
        value: Some(1.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

#[tokio::test]
async fn dispatcher_delivers_once_and_dedups() {
    let pg = Postgres::default().start().await.unwrap();
    let pg_url = format!(
        "postgres://postgres:postgres@127.0.0.1:{}/postgres",
        pg.get_host_port_ipv4(5432).await.unwrap()
    );
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!("redis://127.0.0.1:{}", redis.get_host_port_ipv4(6379).await.unwrap());

    let store = PgStore::connect(&pg_url).await.unwrap();
    store.migrate().await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());

    let hits = Arc::new(Mutex::new(0usize));
    let url = start_webhook(hits.clone()).await;

    let tenant = TenantId(Uuid::new_v4());
    store.create_subscription(tenant, &url).await.unwrap();

    let notifier: Arc<dyn Notifier> = Arc::new(WebhookNotifier::new());
    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let handle = {
        let store = store.clone();
        let bus = bus.clone();
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifier, sd_rx).await;
        })
    };

    // Publish the same event twice; dedup must make only ONE webhook hit.
    bus.publish(&ev(tenant)).await.unwrap();
    bus.publish(&ev(tenant)).await.unwrap();

    // Wait for delivery + dedup to settle.
    for _ in 0..50 {
        if *hits.lock().unwrap() >= 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(500)).await; // give the 2nd a chance (must NOT hit)

    assert_eq!(*hits.lock().unwrap(), 1, "dedup must prevent the second delivery");
    let key = dedup_key(&url, &ev(tenant));
    assert_eq!(store.notification_status(&key).await.unwrap().unwrap().0, "sent");

    let _ = sd_tx.send(true);
    let _ = handle.await;
}
```

- [ ] **Step 3:** Run `cargo test -p cc-dispatcher --test dispatch_it` (Docker). Expect pass. `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`.

- [ ] **Step 4: Commit** — `git add crates/dispatcher && git commit -m "feat(dispatcher): run loop delivering events to subscriptions with dedup/retry/dead-letter"`

---

### Task 6: Evaluator publishes to the EventBus (delete Pusher)

**Files:**
- Modify: `crates/evaluator/Cargo.toml`
- Modify: `crates/evaluator/src/lib.rs`
- Delete: `crates/evaluator/src/pusher.rs`

- [ ] **Step 1: Manifest** — `crates/evaluator/Cargo.toml`: the evaluator no longer needs `reqwest` (delivery moved to the dispatcher). Keep `cc-queue` (already a dep). Remove the `reqwest` dependency line if present. Ensure `cc-queue` is a dependency (it is). No new deps needed beyond `cc-queue`'s `EventBus`.

- [ ] **Step 2: Replace `Pusher` usage with `EventBus` in `crates/evaluator/src/lib.rs`.**

Remove the `pub mod pusher;` line and the `use pusher::Pusher;` import. Change the top imports to add:

```rust
use cc_queue::{Delivery, EventBus, Queue};
```

Change `run_evaluator`'s signature: replace the `pusher: Pusher` parameter with `events: Arc<dyn EventBus>`:

```rust
pub async fn run_evaluator(
    consumer: String,
    store: PgStore,
    queue: Arc<dyn Queue>,
    ch: ChClient,
    events: Arc<dyn EventBus>,
    shutdown: tokio::sync::watch::Receiver<bool>,
) {
```

In the loop, the call `process(&store, &ch, &pusher, &d)` becomes `process(&store, &ch, events.as_ref(), &d)`.

Change `process`'s signature and the event-delivery section. Replace the `pusher: &Pusher` parameter with `events: &dyn EventBus`, and replace the final delivery loop:

```rust
    // 3) Publish events to the event stream for the dispatcher + SSE pump.
    for ev in events_out {
        if let Err(e) = events.publish(&ev).await {
            // Publishing failure is logged; the evaluation state is already persisted.
            // A lost publish means a missed notification for THIS transition (Phase 3
            // adds an outbox to make publish atomic with the state write).
            tracing::error!(error = %e, "publishing event failed");
        }
    }
    Ok(())
```

NOTE: the local `Vec<Event>` in `process` is currently named `events`. Rename that local variable to `events_out` to avoid shadowing the new `events: &dyn EventBus` parameter. Update the two `events.push(ev)` sites to `events_out.push(ev)` and the final loop to iterate `events_out`.

- [ ] **Step 3: Delete the pusher** — `git rm crates/evaluator/src/pusher.rs`.

- [ ] **Step 4:** Run `cargo build -p cc-evaluator` and `cargo clippy -p cc-evaluator --all-targets -- -D warnings`. Fix any leftover references to `Pusher`/`reqwest`/`events_tx` (there should be none). The crate's behavioral coverage is the Task 9 e2e.

- [ ] **Step 5: Commit** — `git add -A crates/evaluator && git commit -m "refactor(evaluator): publish events to EventBus, remove inline pusher"`

---

### Task 7: API SSE pump from the EventBus (`sse_pump.rs`)

**Files:**
- Create: `crates/api/src/sse_pump.rs`
- Modify: `crates/api/src/lib.rs`
- Modify: `crates/api/Cargo.toml`

- [ ] **Step 1: Manifest** — `crates/api/Cargo.toml`: add `cc-queue = { path = "../queue" }` to `[dependencies]`.

- [ ] **Step 2: sse_pump.rs** — `crates/api/src/sse_pump.rs`:

```rust
use cc_domain::Event;
use cc_queue::EventBus;
use std::sync::Arc;
use tokio::sync::broadcast;

/// Background task: tail the event stream and rebroadcast every event into the local
/// `events_tx`, so SSE clients on THIS api replica see events regardless of which
/// process produced them. Runs until `shutdown` flips true. Fan-out (no consumer
/// group): each api replica independently tails from the live tail.
pub async fn run_sse_pump(
    bus: Arc<dyn EventBus>,
    events_tx: broadcast::Sender<Event>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    let mut cursor = "$".to_string(); // only events from now on
    loop {
        if *shutdown.borrow() {
            break;
        }
        let entries = match bus.tail(&cursor, 64, 1000).await {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(error = %e, "sse pump tail failed");
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {}
                    _ = shutdown.changed() => {}
                }
                continue;
            }
        };
        for entry in entries {
            cursor = entry.id.clone();
            // Ignore send error: no SSE subscribers currently connected is fine.
            let _ = events_tx.send(entry.event);
        }
    }
    tracing::info!("sse pump stopped");
}
```

- [ ] **Step 3: Export** — add to `crates/api/src/lib.rs` module list: `pub mod sse_pump;` and `pub use sse_pump::run_sse_pump;`. Also update the stale doc comment on `AppState.events_tx` from "(also fed by the evaluator's pusher)" to "(fed by the SSE pump tailing the event stream)".

- [ ] **Step 4:** Run `cargo build -p cc-api` and `cargo clippy -p cc-api --all-targets -- -D warnings`. (Behavioral coverage: the Task 9 e2e exercises SSE via the pump indirectly; the existing `rules_validation` test still passes.) Run `cargo test -p cc-api`.

- [ ] **Step 5: Commit** — `git add crates/api && git commit -m "feat(api): SSE pump tails event stream into local broadcast"`

---

### Task 8: Binary wiring — dispatcher role, evaluator EventBus, API SSE pump

**Files:**
- Modify: root `Cargo.toml`
- Modify: `src/main.rs`
- Modify: `src/config.rs`

- [ ] **Step 1: Deps** — root `Cargo.toml` `[dependencies]`: add `cc-dispatcher = { path = "crates/dispatcher" }`. (cc-queue already present.) Ensure `members` includes `"crates/dispatcher"` (added in Task 2).

- [ ] **Step 2: main.rs** — rewire. Replace the relevant parts of `src/main.rs`:

Add imports:

```rust
use cc_api::run_sse_pump;
use cc_dispatcher::notify::WebhookNotifier;
use cc_dispatcher::{run_dispatcher, Notifier};
use cc_queue::event_bus::RedisEventBus;
use cc_queue::EventBus;
```

Remove the `use cc_evaluator::pusher::Pusher;` import.

After building `queue`, build the event bus:

```rust
    let event_bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&cfg.redis_url).await?);
```

In the `api` role block, after building the router and BEFORE/with the serve spawn, also spawn the SSE pump:

```rust
    if run("api") {
        let state = AppState {
            store: store.clone(),
            ch: ch.clone(),
            auth: Arc::new(HeaderAuth),
            events_tx: events_tx.clone(),
        };
        // SSE pump: feed this replica's broadcast from the event stream.
        {
            let bus = event_bus.clone();
            let tx = events_tx.clone();
            let rx = sd_rx.clone();
            handles.push(tokio::spawn(async move {
                run_sse_pump(bus, tx, rx).await;
            }));
        }
        let app = build_router(state);
        let listener = tokio::net::TcpListener::bind(&cfg.http_addr).await?;
        tracing::info!(addr = %cfg.http_addr, "api listening");
        handles.push(tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        }));
    }
```

In the `evaluator` role block, replace the `Pusher` construction with the event bus and update the `run_evaluator` call:

```rust
    if run("evaluator") {
        let store = store.clone();
        let queue = queue.clone();
        let ch = ch.clone();
        let events = event_bus.clone();
        let rx = sd_rx.clone();
        let consumer = cfg.node_id.clone();
        handles.push(tokio::spawn(async move {
            run_evaluator(consumer, store, queue, ch, events, rx).await;
        }));
    }
```

Add a new `dispatcher` role block (after the evaluator block):

```rust
    if run("dispatcher") {
        let notifier: Arc<dyn Notifier> = Arc::new(WebhookNotifier::new());
        let store = store.clone();
        let bus = event_bus.clone();
        let rx = sd_rx.clone();
        let consumer = cfg.node_id.clone();
        handles.push(tokio::spawn(async move {
            run_dispatcher(consumer, store, bus, notifier, rx).await;
        }));
    }
```

The `events_tx` broadcast channel stays (now fed by the SSE pump rather than the evaluator). The `let (events_tx, _rx) = tokio::sync::broadcast::channel::<Event>(1024);` line stays; `Event` import stays.

- [ ] **Step 3: config note.** No new env vars required — `CC_ROLE=all` now also starts the dispatcher and SSE pump. (Optionally document `dispatcher` as a valid `CC_ROLE` value in a comment near `Config`.)

- [ ] **Step 4:** Run `cargo build` (whole workspace) and `cargo clippy --all-targets -- -D warnings`. Fix minimally.

- [ ] **Step 5: Commit** — `git add Cargo.toml src/ && git commit -m "feat(bin): add dispatcher role; evaluator publishes events; api runs SSE pump"`

---

### Task 9: End-to-end dispatch test

**Files:**
- Modify: root `Cargo.toml` (`[dev-dependencies]`: add `cc-dispatcher`)
- Create: `tests/e2e_dispatch.rs`

This is the capstone: a rule fires in the evaluator → event published to the stream → the dispatcher delivers a webhook and records a `sent` notification; the SSE pump rebroadcasts the event. It reuses the Phase 1 e2e stub pattern (stub ClickHouse returning a row, stub webhook capturing deliveries) but drives the NEW path (evaluator publishes; dispatcher delivers).

- [ ] **Step 1: dev-dep** — add `cc-dispatcher = { path = "crates/dispatcher" }` to root `[dev-dependencies]`.

- [ ] **Step 2: e2e** — `tests/e2e_dispatch.rs`:

```rust
use cc_clickhouse::ChClient;
use cc_dispatcher::notify::WebhookNotifier;
use cc_dispatcher::{run_dispatcher, Notifier};
use cc_domain::ids::TenantId;
use cc_domain::rule::{RuleSpec, Severity};
use cc_evaluator::run_evaluator;
use cc_queue::event_bus::RedisEventBus;
use cc_queue::redis_streams::RedisQueue;
use cc_queue::{EvalJob, EventBus, Queue};
use cc_stores::PgStore;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

type Captured = Arc<Mutex<Vec<serde_json::Value>>>;

async fn stub_clickhouse() -> String {
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route("/", post(|| async { "{\"service\":\"api\",\"n\":5}\n".to_string() }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok(); });
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
    tokio::spawn(async move { axum::serve(listener, app).await.ok(); });
    format!("http://{addr}/hook")
}

#[tokio::test]
async fn evaluator_publishes_dispatcher_delivers() {
    let pg = Postgres::default().start().await.unwrap();
    let pg_url = format!(
        "postgres://postgres:postgres@127.0.0.1:{}/postgres",
        pg.get_host_port_ipv4(5432).await.unwrap()
    );
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!("redis://127.0.0.1:{}", redis.get_host_port_ipv4(6379).await.unwrap());

    let store = PgStore::connect(&pg_url).await.unwrap();
    store.migrate().await.unwrap();
    let queue: Arc<dyn Queue> = Arc::new(RedisQueue::connect(&redis_url).await.unwrap());
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());

    let ch = ChClient::new(stub_clickhouse().await, "default", "");
    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    let tenant = TenantId(Uuid::new_v4());
    store.create_subscription(tenant, &hook).await.unwrap();
    let spec = RuleSpec {
        sql: "SELECT service, count() AS n FROM spans GROUP BY service".into(),
        interval_secs: 1,
        for_secs: 0,
        label_columns: vec!["service".into()],
        value_column: Some("n".into()),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
    };
    let rule = store.create_rule(tenant, &spec).await.unwrap();

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);

    // Start evaluator (publishes to bus) and dispatcher (delivers from bus).
    let ev_handle = {
        let (store, queue, bus, rx) = (store.clone(), queue.clone(), bus.clone(), sd_rx.clone());
        tokio::spawn(async move {
            run_evaluator("e1".into(), store, queue, ch, bus, rx).await;
        })
    };
    let disp_handle = {
        let notifier: Arc<dyn Notifier> = Arc::new(WebhookNotifier::new());
        let (store, bus, rx) = (store.clone(), bus.clone(), sd_rx.clone());
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifier, rx).await;
        })
    };

    // Drive one evaluation: enqueue a job; evaluator fires -> publishes -> dispatcher delivers.
    queue
        .enqueue(&EvalJob { tenant, rule: rule.id, eval_ts: OffsetDateTime::now_utc() })
        .await
        .unwrap();

    for _ in 0..100 {
        if !captured.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let got = captured.lock().unwrap();
    assert_eq!(got.len(), 1, "exactly one webhook delivery");
    assert_eq!(got[0]["status"], "firing");
    assert_eq!(got[0]["labels"]["service"], "api");

    let _ = sd_tx.send(true);
    let _ = ev_handle.await;
    let _ = disp_handle.await;
}
```

- [ ] **Step 3:** Run `cargo test --test e2e_dispatch` (Docker). Must PASS. Then run the FULL suite `cargo test --workspace 2>&1 | tail -40` — confirm all green (the Phase 1 `tests/e2e.rs` still references the OLD path; see note).

NOTE ON PHASE 1 e2e: the Phase 1 `tests/e2e.rs` constructed a `Pusher` and called `run_evaluator(..., pusher, ...)`. Since Task 6 changed `run_evaluator`'s signature to take `Arc<dyn EventBus>` and deleted `Pusher`, that old test no longer compiles. UPDATE `tests/e2e.rs` minimally: replace its evaluator wiring to publish to a `RedisEventBus` and assert delivery through a `run_dispatcher` (i.e. it becomes equivalent to this new test), OR delete `tests/e2e.rs` in favor of `tests/e2e_dispatch.rs` since the latter supersedes it. Prefer DELETING `tests/e2e.rs` (this new test covers the same fire→deliver path through the corrected architecture). Document the deletion in the commit.

- [ ] **Step 4: Commit** — `git add -A tests Cargo.toml && git commit -m "test(e2e): evaluator publishes, dispatcher delivers; supersede phase 1 pusher e2e"`

---

### Task 10: Quality gate

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** `cargo fmt --all` then `cargo clippy --all-targets -- -D warnings` — fix any findings. `cargo build`.

- [ ] **Step 2: Update README** — add a "Dispatch" section to `README.md` under the existing content:

```markdown
## Roles (updated)

`CC_ROLE` ∈ `api` | `scheduler` | `evaluator` | `dispatcher` | `all`.

The evaluator publishes firing/resolved events to the Redis event stream
(`cc:events`). The **dispatcher** consumes that stream and delivers each event to
the tenant's registered webhooks, with deduplication (notification log), bounded
retry/backoff, and a dead-letter stream (`cc:events:deadletter`). The api role
tails the same stream to feed SSE clients on every replica.
```

- [ ] **Step 3: Final checks** — `cargo fmt --all -- --check` clean; `cargo clippy --all-targets -- -D warnings` clean; `cargo build` clean.

- [ ] **Step 4: Commit** — `git add README.md && git commit -m "chore: phase 2a readme, fmt/clippy gate"`

---

## Self-Review

**Spec coverage (Phase 2a portion of the design's Dispatch Pipeline):**
- Standalone dispatcher consuming the events stream → Tasks 0, 5, 8. ✓
- Dedup (no duplicate notifications) → Task 1 (notification log) + Task 2 (dedup_key) + Task 5 (gate). ✓
- Delivery + retry/backoff + dead-letter → Tasks 3, 4, 5. ✓
- Durable notification log (at-least-once-with-dedup) → Tasks 1, 5. ✓
- `Notifier` trait so Phase 2b channels are additive → Task 3. ✓
- Evaluator decoupled from delivery (publishes to stream) → Task 6. ✓
- SSE works across processes (fed from stream) → Task 7, 8. ✓
- Pipeline never touches ClickHouse (dispatch decoupled from query load) → dispatcher only reads Postgres + Redis + webhooks. ✓

**Explicitly deferred to Phase 2b (documented in Scope):** grouping + `group_wait`/`group_interval` timers; routing tree + receivers CRUD; Slack / email-SMTP / PagerDuty channels. Silences/inhibition remain Phase 3.

**Placeholder scan:** no `TODO`/`TBD` in code steps; every step has complete code or an exact command. The two intentional limitations (stale-`pending` redelivery window; publish-not-atomic-with-state-write) are documented in code comments with the Phase-3 remediation named, not left as silent gaps.

**Type consistency:** `EventBus`/`EventEntry` (Task 0) are used identically in dispatcher (Task 5), evaluator (Task 6), api pump (Task 7), and binary (Task 8). `dedup_key(target, &Event)` signature matches its call sites in Task 5 and the Task 5/9 tests. `Notifier::{channel, send}` and `NotifyError::{Transient, Permanent}` (Task 3) match `deliver_with_retry` (Task 4) and `process_event` (Task 5). `try_begin_notification`/`mark_notification_sent`/`mark_notification_failed`/`notification_status` (Task 1) match all call sites. `run_evaluator`'s new signature (Task 6) matches the binary (Task 8) and the e2e (Task 9). `run_dispatcher(consumer, store, bus, notifier, shutdown)` is consistent across Tasks 5, 8, 9.
