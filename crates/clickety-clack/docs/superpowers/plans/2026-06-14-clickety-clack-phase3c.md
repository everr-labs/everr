# Clickety-Clack Phase 3C — Scale & Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let clickety-clack scale horizontally (sharded scheduler, coalesced ClickHouse queries) and stay backend-portable (Redis-isms sealed out of the `Queue`/`EventBus` seam), with no behavior change in the single-replica / Redis-only case.

**Architecture:** Three independent threads. (1) Scheduler tenant-sharding via leaderless rendezvous (HRW) hashing over a Redis heartbeat registry; default `CC_SCHEDULER_SHARDS=1` makes it a self-electing auto-failover singleton, parallelism opt-in. (2) Within-batch identical-query coalescing in the evaluator, keyed by `(sql, label_columns, value_column)`, behind a new `RowQuerier` trait seam. (3) Kafka-ready seam hardening: opaque `JobId`/`EventId` newtypes, a typed `TailCursor` replacing the `"$"` sentinel, and a backend-conformance test suite.

**Tech Stack:** Rust workspace; tokio; sqlx (Postgres); redis (Streams + Lua `Script`); testcontainers-modules (Postgres + Redis); async-trait; time.

**Spec:** `docs/superpowers/specs/2026-06-14-clickety-clack-phase3c-scale.md` (committed `3ce4968`). Branch `feat/phase3c-scale`, base main `3d29521`.

**Conventions:** TDD bite-sized steps; `cargo clippy --all-targets -- -D warnings` clean; `cargo fmt --all -- --check` clean; real gate `cargo test --workspace --no-fail-fast`; Docker required for testcontainers ITs. **No Claude/AI attribution anywhere in commits, PRs, or code.**

---

## File Structure

**Thread 3 — seam hardening**
- `crates/queue/src/lib.rs` (MODIFY) — add `JobId`, `EventId` opaque newtypes + `TailCursor` enum; retype `Delivery.id`/`EventEntry.id`; retype `Queue::ack`/`EventBus::ack`/`EventBus::tail`; add Backend-contract rustdoc.
- `crates/queue/src/redis_streams.rs` (MODIFY) — construct `JobId`; ack via inner str.
- `crates/queue/src/event_bus.rs` (MODIFY) — construct `EventId`; ack via inner str; map `TailCursor` to XREAD id.
- `crates/api/src/sse_pump.rs` (MODIFY) — drive the tail with `TailCursor` instead of `"$"`.
- `crates/dispatcher/src/lib.rs` (MODIFY) — `firehose_deliver` takes `&EventId`.
- `crates/queue/tests/event_bus_it.rs` (MODIFY) — use `TailCursor`.
- `crates/queue/tests/conformance.rs` (CREATE) — backend-agnostic contract suite, run against Redis impls.

**Thread 2 — query coalescing**
- `crates/clickhouse/src/lib.rs` (MODIFY) — add `RowQuerier` trait + `impl RowQuerier for ChClient`.
- `crates/clickhouse/Cargo.toml` (MODIFY) — add `async-trait`.
- `crates/evaluator/src/lib.rs` (MODIFY) — `run_evaluator` takes `Arc<dyn RowQuerier>`; replace per-delivery `process` with `process_batch` + `evaluate_rule_against_rows` + private `QuerySig`; unit tests for `QuerySig`.
- `crates/evaluator/tests/coalescing_it.rs` (CREATE) — counting `RowQuerier` double proves one query for identical SQL.
- `tests/e2e_dispatch.rs`, `tests/e2e_durability.rs`, `src/main.rs` (MODIFY) — wrap `ch` in `Arc` at the `run_evaluator` call.

**Thread 1 — scheduler sharding**
- `crates/scheduler/src/membership.rs` (CREATE) — pure `owned_shards`/`hash64` (HRW) + `MembershipRegistry` (heartbeat Lua).
- `crates/scheduler/src/lib.rs` (MODIFY) — `pub mod membership;`; rewrite `run_scheduler` to heartbeat → HRW → `claim_due_rules_sharded`; drop the `RedisLease` param.
- `crates/scheduler/Cargo.toml` (MODIFY) — add `redis`; dev-deps `testcontainers`, `testcontainers-modules`.
- `crates/scheduler/tests/membership_it.rs` (CREATE) — heartbeat register/list/evict (Redis).
- `crates/stores/src/pg.rs` (MODIFY) — add `claim_due_rules_sharded`.
- `crates/stores/tests/sharding_it.rs` (CREATE) — partition correctness (Postgres).
- `src/config.rs` (MODIFY) — `CC_SCHEDULER_SHARDS` (default 1), `CC_SCHEDULER_MEMBER_TTL_MS` (default 10000).
- `src/main.rs` (MODIFY) — scheduler block uses `MembershipRegistry`; remove `cc:scheduler:lease`.

Order rationale: Thread 3 first seals the trait types so Thread 2's evaluator restructure uses final types; Thread 1 is independent and last.

---

## Thread 3 — Kafka-ready seam hardening

### Task 1: Opaque `JobId` / `EventId` newtypes

Seals the transport's id/offset format inside `cc-queue`. This is a type-refactor guarded by the existing `cc-queue` ITs and the workspace build (no new unit test; Task 3 adds the behavioral suite).

**Files:**
- Modify: `crates/queue/src/lib.rs`
- Modify: `crates/queue/src/redis_streams.rs`
- Modify: `crates/queue/src/event_bus.rs`
- Modify: `crates/dispatcher/src/lib.rs:188-194` (firehose signature)

- [ ] **Step 1: Add the newtypes to `crates/queue/src/lib.rs`**

Insert after the `QueueError` enum (before `EvalJob`):

```rust
/// Opaque transport id for a consumed eval job. The backend's id/offset format is sealed
/// inside this crate; callers only move it around and ack with it (Redis stream id today,
/// Kafka partition/offset later).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct JobId(pub(crate) String);

impl JobId {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for JobId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Opaque transport id for a consumed/tailed stream event. Same sealing rationale as
/// [`JobId`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EventId(pub(crate) String);

impl EventId {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for EventId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
```

- [ ] **Step 2: Retype the id fields and ack signatures in `crates/queue/src/lib.rs`**

Change `Delivery`:

```rust
/// Opaque handle used to ack a consumed message.
#[derive(Debug, Clone)]
pub struct Delivery {
    pub id: JobId,
    pub job: EvalJob,
}
```

Change `EventEntry`:

```rust
/// One event read from the event stream (consume-group or tail).
#[derive(Debug, Clone, PartialEq)]
pub struct EventEntry {
    pub id: EventId,
    pub event: Event,
}
```

In the `Queue` trait, change `ack`:

```rust
    async fn ack(&self, id: &JobId) -> Result<(), QueueError>;
```

In the `EventBus` trait, change `ack`:

```rust
    async fn ack(&self, id: &EventId) -> Result<(), QueueError>;
```

- [ ] **Step 3: Update the Redis `Queue` impl in `crates/queue/src/redis_streams.rs`**

In `consume`, construct the newtype:

```rust
                    out.push(Delivery {
                        id: JobId(entry.id),
                        job,
                    });
```

Change `ack`:

```rust
    async fn ack(&self, id: &JobId) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(STREAM, GROUP, &[id.as_str()]).await?;
        Ok(())
    }
```

Update the `use` line to bring in `JobId`:

```rust
use crate::{Delivery, EvalJob, JobId, Queue, QueueError};
```

- [ ] **Step 4: Update the Redis `EventBus` impl in `crates/queue/src/event_bus.rs`**

In `parse_entries`, construct the newtype:

```rust
                    out.push(EventEntry {
                        id: EventId(entry.id),
                        event,
                    });
```

Change `ack`:

```rust
    async fn ack(&self, id: &EventId) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(STREAM, GROUP, &[id.as_str()]).await?;
        Ok(())
    }
```

Update the `use` line:

```rust
use crate::{EventBus, EventEntry, EventId, QueueError};
```

- [ ] **Step 5: Update `firehose_deliver` in `crates/dispatcher/src/lib.rs`**

Change the parameter type (the call site `firehose_deliver(store, bus, notifiers, ev, &entry.id)` is unchanged — `entry.id` is now an `&EventId`, and `%entry_id` still works via `Display`):

```rust
async fn firehose_deliver(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    ev: &Event,
    entry_id: &cc_queue::EventId,
) -> bool {
```

- [ ] **Step 6: Build + clippy + run the queue and dispatcher ITs**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: clean (no `&str`-vs-newtype mismatches remain).

Run: `cargo test -p cc-queue -p cc-dispatcher --no-fail-fast`
Expected: PASS — existing roundtrip ITs (`enqueue_consume_ack_roundtrip`, `publish_consume_ack_and_tail`) still pass; `q.ack(&got[0].id)` now passes a `&JobId`/`&EventId`.

- [ ] **Step 7: Commit**

```bash
git add crates/queue/src/lib.rs crates/queue/src/redis_streams.rs crates/queue/src/event_bus.rs crates/dispatcher/src/lib.rs
git commit -m "Seal transport ids behind opaque JobId/EventId newtypes"
```

---

### Task 2: Typed `TailCursor` (kill the `\"$\"` sentinel)

**Files:**
- Modify: `crates/queue/src/lib.rs`
- Modify: `crates/queue/src/event_bus.rs`
- Modify: `crates/api/src/sse_pump.rs`
- Test: `crates/queue/tests/event_bus_it.rs`

- [ ] **Step 1: Update the failing test in `crates/queue/tests/event_bus_it.rs`**

Replace the `use cc_queue::EventBus;` line with:

```rust
use cc_queue::{EventBus, TailCursor};
```

In `tail_reads_only_new_after_cursor`, replace the two `tail` calls and the cursor:

```rust
    let entries = bus.tail(&TailCursor::Live, 10, 1500).await.unwrap();
    assert_eq!(
        entries.len(),
        1,
        "tail(Live) must catch the event published during the block"
    );
    let cursor = TailCursor::After(entries.last().unwrap().id.clone());

    // No further publishes -> tail from the cursor returns empty within the window.
    let none = bus.tail(&cursor, 10, 300).await.unwrap();
    assert!(none.is_empty());
```

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `cargo test -p cc-queue --test event_bus_it`
Expected: FAIL — `no variant or associated item named Live`/`tail` arg mismatch (`TailCursor` not yet defined; `tail` still takes `&str`).

- [ ] **Step 3: Add `TailCursor` to `crates/queue/src/lib.rs`**

Insert after the `EventId` newtype block:

```rust
/// Where a fan-out tail starts. Backend-agnostic: `Live` = the current tail (Redis `"$"`,
/// Kafka latest offset); `After(id)` resumes strictly after a previously-seen position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TailCursor {
    Live,
    After(EventId),
}
```

Change the `EventBus::tail` signature in the trait:

```rust
    /// Fan-out tail for SSE: read entries strictly after `cursor` (`TailCursor::Live`
    /// starts at the live tail). Returns entries in order; the caller advances its own
    /// cursor with `TailCursor::After(last_returned_id)`. No consumer group — every caller
    /// sees every event.
    async fn tail(
        &self,
        cursor: &TailCursor,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError>;
```

- [ ] **Step 4: Map the cursor in `crates/queue/src/event_bus.rs`**

Update the `use` line:

```rust
use crate::{EventBus, EventEntry, EventId, QueueError, TailCursor};
```

Replace the `tail` impl:

```rust
    async fn tail(
        &self,
        cursor: &TailCursor,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        // Map the backend-agnostic cursor to Redis Streams' XREAD id: `Live` => "$" (only
        // entries added after this blocking call — a live tail, never historical replay);
        // `After(id)` => that stream id.
        let read_id: &str = match cursor {
            TailCursor::Live => "$",
            TailCursor::After(id) => id.as_str(),
        };
        let mut conn = self.conn.clone();
        let opts = StreamReadOptions::default().count(count).block(block_ms);
        let reply: StreamReadReply = conn.xread_options(&[STREAM], &[read_id], &opts).await?;
        Self::parse_entries(reply)
    }
```

- [ ] **Step 5: Drive the SSE pump with `TailCursor` in `crates/api/src/sse_pump.rs`**

Update the `use` line:

```rust
use cc_queue::{EventBus, TailCursor};
```

Replace the cursor init and advance:

```rust
    let mut cursor = TailCursor::Live; // only events from now on
```

and inside the `for entry in entries` loop:

```rust
        for entry in entries {
            cursor = TailCursor::After(entry.id.clone());
            // Ignore send error: no SSE subscribers currently connected is fine.
            let _ = events_tx.send(entry.event);
        }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cargo test -p cc-queue --test event_bus_it`
Expected: PASS.

Run: `cargo clippy --all-targets -- -D warnings`
Expected: clean (`cc-api` builds against the new `tail` signature).

- [ ] **Step 7: Commit**

```bash
git add crates/queue/src/lib.rs crates/queue/src/event_bus.rs crates/api/src/sse_pump.rs crates/queue/tests/event_bus_it.rs
git commit -m "Replace the \"\$\" tail sentinel with a typed TailCursor"
```

---

### Task 3: Backend-conformance suite + Backend-contract docs

A backend-agnostic harness over `Arc<dyn Queue>` / `Arc<dyn EventBus>`, run against the Redis impls now and re-runnable against any future backend. It asserts only behaviors the current impls actually guarantee (see the note on redelivery below).

**Files:**
- Create: `crates/queue/tests/conformance.rs`
- Modify: `crates/queue/src/lib.rs` (trait rustdoc)

> **Scope note (honest contract):** the suite asserts: enqueue→deliver, ack→not-redelivered, publish→consume→ack, `tail(Live)` sees post-start events, `tail(After)` resumes strictly after the cursor, and `dead_letter` records without error. It does **not** assert crash-redelivery of unacked messages: the Redis impl keeps unacked entries in the consumer-group PEL but has no reclaim (`XAUTOCLAIM`) path yet — same as today. The trait rustdoc states at-least-once-via-PEL-plus-future-reclaim in prose so the contract is documented even though the automated assertion is deferred.

- [ ] **Step 1: Write the conformance suite `crates/queue/tests/conformance.rs`**

```rust
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::rule::Severity;
use cc_queue::event_bus::RedisEventBus;
use cc_queue::redis_streams::RedisQueue;
use cc_queue::{EvalJob, EventBus, Queue, TailCursor};
use std::collections::BTreeMap;
use std::sync::Arc;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

fn job() -> EvalJob {
    EvalJob {
        tenant: TenantId(Uuid::nil()),
        rule: RuleId(Uuid::nil()),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

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
    assert!(after.is_empty(), "acked event must not be redelivered as new");
}

async fn eventbus_tail_fanout(bus: Arc<dyn EventBus>, bus2: Arc<dyn EventBus>) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        bus2.publish(&ev()).await.unwrap();
    });
    let entries = bus.tail(&TailCursor::Live, 10, 1500).await.unwrap();
    assert_eq!(
        entries.len(),
        1,
        "tail(Live) must see events published after it starts"
    );
    let cursor = TailCursor::After(entries.last().unwrap().id.clone());
    let none = bus.tail(&cursor, 10, 300).await.unwrap();
    assert!(none.is_empty(), "tail(After) resumes strictly after the cursor");
}

async fn eventbus_dead_letter(bus: Arc<dyn EventBus>) {
    bus.dead_letter(&ev(), "boom").await.unwrap();
}

async fn redis_url() -> (
    String,
    testcontainers_modules::testcontainers::ContainerAsync<Redis>,
) {
    let node = Redis::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    (format!("redis://127.0.0.1:{port}"), node)
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
    let bus2: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&url).await.unwrap());
    eventbus_tail_fanout(bus.clone(), bus2).await;
    eventbus_dead_letter(bus).await;
}
```

- [ ] **Step 2: Run the suite to verify it passes**

Run: `cargo test -p cc-queue --test conformance`
Expected: PASS — both `redis_queue_conforms` and `redis_event_bus_conforms` green.

- [ ] **Step 3: Add the Backend-contract rustdoc to `crates/queue/src/lib.rs`**

Above the `Queue` trait:

```rust
/// Swappable transport for evaluation jobs. Redis Streams now, Kafka later.
///
/// # Backend contract
/// Any implementation MUST provide: at-least-once delivery (a job survives until acked);
/// `ack(id)` permanently removes that delivery from the never-delivered set; and
/// `consume` returns each job to exactly one consumer in the group until acked. Unacked
/// jobs remain claimable for redelivery via a backend reclaim mechanism (Redis: the
/// consumer-group PEL; reclaim wiring is future work). See `tests/conformance.rs`.
```

Above the `EventBus` trait:

```rust
/// Transport for firing/resolved events: evaluator publishes, dispatcher consumes
/// (shared group), api tails (fan-out) for SSE. Redis Streams now, Kafka later.
///
/// # Backend contract
/// `consume` is an at-least-once shared-group read acked by `ack(id)`. `tail` is a
/// group-less fan-out: every caller sees every event, `Live` starts at the current tail
/// and `After(id)` resumes strictly after a prior position. `dead_letter` records a
/// permanently-undeliverable event out-of-band. See `tests/conformance.rs`.
```

- [ ] **Step 4: Verify docs build and the suite still passes**

Run: `cargo clippy --all-targets -- -D warnings && cargo test -p cc-queue --test conformance`
Expected: clean + PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/queue/tests/conformance.rs crates/queue/src/lib.rs
git commit -m "Add backend-conformance suite and document the Queue/EventBus contract"
```

---

## Thread 2 — Within-batch identical-query coalescing

### Task 4: `RowQuerier` trait seam over ClickHouse

Introduces the testable seam and routes the evaluator through it, with no behavior change yet (still one query per delivery).

**Files:**
- Modify: `crates/clickhouse/src/lib.rs`
- Modify: `crates/clickhouse/Cargo.toml`
- Modify: `crates/evaluator/src/lib.rs`
- Modify: `src/main.rs`, `tests/e2e_dispatch.rs`, `tests/e2e_durability.rs`

- [ ] **Step 1: Add `async-trait` to `crates/clickhouse/Cargo.toml`**

Under `[dependencies]`, add:

```toml
async-trait.workspace = true
```

- [ ] **Step 2: Add the `RowQuerier` trait + impl in `crates/clickhouse/src/lib.rs`**

At the top, add the import:

```rust
use async_trait::async_trait;
```

After the `impl ChClient` block, add:

```rust
/// The row-query seam the evaluator depends on. Implemented by [`ChClient`] in production
/// and by a counting double in tests, so coalescing (one query per identical signature)
/// can be asserted without a live ClickHouse.
#[async_trait]
pub trait RowQuerier: Send + Sync {
    async fn query_rows(
        &self,
        sql: &str,
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError>;
}

#[async_trait]
impl RowQuerier for ChClient {
    async fn query_rows(
        &self,
        sql: &str,
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        ChClient::query_rows(self, sql, label_columns, value_column).await
    }
}
```

- [ ] **Step 3: Route the evaluator through `Arc<dyn RowQuerier>` in `crates/evaluator/src/lib.rs`**

Replace `use cc_clickhouse::ChClient;` with:

```rust
use cc_clickhouse::RowQuerier;
```

Change the `run_evaluator` signature parameter `ch: ChClient` to:

```rust
    ch: std::sync::Arc<dyn RowQuerier>,
```

(`std::sync::Arc` is already imported via `use std::sync::Arc;` — use `Arc<dyn RowQuerier>`.)

In the consume loop, change the `process` call to pass the trait object:

```rust
                match process(&store, ch.as_ref(), events.as_ref(), &d).await {
```

Change the `process` signature parameter `ch: &ChClient` to:

```rust
    ch: &dyn RowQuerier,
```

(No other change in Task 4 — `process` still queries once per delivery; restructuring is Task 5.)

- [ ] **Step 4: Update the three `run_evaluator` call sites**

`src/main.rs` — in the evaluator block, change the cloned `ch` into an `Arc<dyn RowQuerier>`:

```rust
            let ch: std::sync::Arc<dyn cc_clickhouse::RowQuerier> = std::sync::Arc::new(ch.clone());
```

(Place it where `let ch = ch.clone();` currently is, around `src/main.rs:85`.)

`tests/e2e_dispatch.rs:101` and `tests/e2e_durability.rs:142` — wrap the local `ch` at the call:

```rust
            run_evaluator("e1".into(), store, queue, std::sync::Arc::new(ch), bus, rx).await;
```

- [ ] **Step 5: Build + clippy + regression**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: clean.

Run: `cargo test -p cc-evaluator --no-fail-fast`
Expected: PASS (existing `maintenance_it` unaffected).

- [ ] **Step 6: Commit**

```bash
git add crates/clickhouse/Cargo.toml crates/clickhouse/src/lib.rs crates/evaluator/src/lib.rs src/main.rs tests/e2e_dispatch.rs tests/e2e_durability.rs
git commit -m "Add RowQuerier seam and route the evaluator through it"
```

---

### Task 5: Within-batch coalescing (`process_batch` + `QuerySig`)

**Files:**
- Modify: `crates/evaluator/src/lib.rs`

- [ ] **Step 1: Write the failing `QuerySig` unit tests in `crates/evaluator/src/lib.rs`**

Append at the end of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::rule::Severity;
    use std::collections::BTreeMap;

    fn spec(sql: &str, labels: &[&str], val: Option<&str>) -> cc_domain::rule::RuleSpec {
        cc_domain::rule::RuleSpec {
            sql: sql.into(),
            interval_secs: 30,
            for_secs: 0,
            label_columns: labels.iter().map(|s| s.to_string()).collect(),
            value_column: val.map(|s| s.to_string()),
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            resolve_after: 1,
        }
    }

    #[test]
    fn identical_specs_share_signature() {
        assert_eq!(
            QuerySig::of(&spec("SELECT 1", &["a"], Some("v"))),
            QuerySig::of(&spec("SELECT 1", &["a"], Some("v"))),
        );
    }

    #[test]
    fn differing_fields_separate_signatures() {
        let base = QuerySig::of(&spec("SELECT 1", &["a"], Some("v")));
        assert_ne!(base, QuerySig::of(&spec("SELECT 2", &["a"], Some("v"))));
        assert_ne!(base, QuerySig::of(&spec("SELECT 1", &["b"], Some("v"))));
        assert_ne!(base, QuerySig::of(&spec("SELECT 1", &["a"], None)));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p cc-evaluator --lib`
Expected: FAIL — `cannot find type/function QuerySig`.

- [ ] **Step 3: Add `QuerySig` and the batch functions in `crates/evaluator/src/lib.rs`**

Update imports at the top:

```rust
use cc_clickhouse::{ResultRow, RowQuerier};
use cc_domain::ids::InstanceKey;
use cc_domain::instance::InstanceState;
use cc_domain::rule::{Rule, RuleSpec};
use cc_domain::Event;
use cc_engine::{evaluate, EvalInput};
use cc_queue::{Delivery, EventBus, JobId, Queue};
use cc_stores::PgStore;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration;
```

Add `QuerySig` (place it above `run_evaluator`):

```rust
/// Identity of a ClickHouse query for coalescing. Two jobs share a single round-trip iff
/// these three fields match — they fully determine the wire query and how rows are parsed.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct QuerySig {
    sql: String,
    label_columns: Vec<String>,
    value_column: Option<String>,
}

impl QuerySig {
    fn of(spec: &RuleSpec) -> Self {
        Self {
            sql: spec.sql.clone(),
            label_columns: spec.label_columns.clone(),
            value_column: spec.value_column.clone(),
        }
    }
}
```

- [ ] **Step 4: Replace the consume loop body and `process` in `crates/evaluator/src/lib.rs`**

In `run_evaluator`, replace the `for d in deliveries { ... }` block with a single batch call + ack loop:

```rust
        let to_ack = process_batch(&store, ch.as_ref(), events.as_ref(), deliveries).await;
        for id in to_ack {
            if let Err(e) = queue.ack(&id).await {
                tracing::error!(error = %e, "ack failed");
            }
        }
```

Delete the old `process` function and replace it with `process_batch` + `evaluate_rule_against_rows`:

```rust
/// Process one consume batch with identical-query coalescing. Jobs are claimed and their
/// rules resolved per-delivery (idempotency unchanged), grouped by [`QuerySig`], and each
/// distinct query is run once and fanned out to every rule sharing it. Every input
/// delivery is acked (success or recorded eval-error), matching the prior per-delivery
/// behavior. Returns the ids to ack.
pub async fn process_batch(
    store: &PgStore,
    ch: &dyn RowQuerier,
    events: &dyn EventBus,
    deliveries: Vec<Delivery>,
) -> Vec<JobId> {
    let ack_ids: Vec<JobId> = deliveries.iter().map(|d| d.id.clone()).collect();

    // 1) Claim + resolve rule per delivery (per-job, so dedup semantics are unchanged).
    let mut resolved: Vec<(cc_queue::EvalJob, Rule)> = Vec::new();
    for d in deliveries {
        let job = d.job;
        match store.try_claim_eval(job.rule, job.eval_ts).await {
            Ok(true) => {}
            Ok(false) => continue, // another worker claimed this (rule, eval_ts)
            Err(e) => {
                tracing::error!(rule = ?job.rule, error = %e, "claim_eval failed");
                continue;
            }
        }
        match store.get_rule(job.tenant, job.rule).await {
            Ok(Some(r)) => resolved.push((job, r)),
            Ok(None) => {} // rule deleted; nothing to do
            Err(e) => tracing::error!(rule = ?job.rule, error = %e, "get_rule failed"),
        }
    }

    // 2) Group by query signature.
    let mut groups: HashMap<QuerySig, Vec<(cc_queue::EvalJob, Rule)>> = HashMap::new();
    for (job, rule) in resolved {
        groups.entry(QuerySig::of(&rule.spec)).or_default().push((job, rule));
    }

    // 3) Run each distinct query once; 4) fan out to each rule in the group.
    for members in groups.into_values() {
        let sample = &members[0].1;
        let rows = match ch
            .query_rows(
                &sample.spec.sql,
                &sample.spec.label_columns,
                sample.spec.value_column.as_deref(),
            )
            .await
        {
            Ok(r) => r,
            Err(e) => {
                // A query failure fails only this group's jobs; other groups are unaffected.
                for (job, _) in &members {
                    tracing::error!(rule = ?job.rule, error = %e, "evaluation query errored");
                    let _ = store.record_eval_error(job.rule, &e.to_string()).await;
                }
                continue;
            }
        };
        for (job, rule) in members {
            if let Err(e) = evaluate_rule_against_rows(store, events, &rule, &job, &rows).await {
                tracing::error!(rule = ?job.rule, error = %e, "evaluation errored");
                let _ = store.record_eval_error(job.rule, &e.to_string()).await;
            }
        }
    }

    ack_ids
}

/// Evaluate one rule against pre-fetched rows (the per-rule body of the former `process`).
/// Builds the present-set, runs the absence path for known-but-absent instances, and
/// publishes each transition. Identical to the prior logic except rows are supplied.
async fn evaluate_rule_against_rows(
    store: &PgStore,
    events: &dyn EventBus,
    rule: &Rule,
    job: &cc_queue::EvalJob,
    rows: &[ResultRow],
) -> anyhow::Result<()> {
    let mut present: HashMap<InstanceKey, (BTreeMap<String, String>, Option<f64>)> = HashMap::new();
    for row in rows {
        let key = InstanceKey::new(job.rule, &row.labels);
        present.insert(key, (row.labels.clone(), row.value));
    }

    let known = store.load_instances(job.rule).await?;
    let mut known_keys: HashMap<InstanceKey, InstanceState> =
        known.into_iter().map(|s| (s.key.clone(), s)).collect();

    // 1) Evaluate every present row.
    for (key, (labels, value)) in &present {
        let prev = known_keys.remove(key).unwrap_or_else(|| {
            InstanceState::new_inactive(key.clone(), job.rule, job.tenant, labels.clone())
        });
        let input = EvalInput {
            present: true,
            value: *value,
            labels: labels.clone(),
            for_duration: rule.spec.for_duration(),
            resolve_after: rule.spec.resolve_after,
            severity: rule.spec.severity,
            annotations: &rule.spec.annotations,
            eval_ts: job.eval_ts,
        };
        let out = evaluate(prev, input);
        publish_transition(store, events, &out.next, out.event).await?;
    }

    // 2) Evaluate every previously-known instance NOT present now (absence path).
    for (_key, prev) in known_keys {
        let labels = prev.labels.clone();
        let input = EvalInput {
            present: false,
            value: None,
            labels,
            for_duration: rule.spec.for_duration(),
            resolve_after: rule.spec.resolve_after,
            severity: rule.spec.severity,
            annotations: &rule.spec.annotations,
            eval_ts: job.eval_ts,
        };
        let out = evaluate(prev, input);
        publish_transition(store, events, &out.next, out.event).await?;
    }

    Ok(())
}
```

(`publish_transition` is unchanged. The `Delivery` import is still used by `process_batch`.)

- [ ] **Step 5: Run unit tests + clippy**

Run: `cargo test -p cc-evaluator --lib`
Expected: PASS — both `QuerySig` tests green.

Run: `cargo clippy --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add crates/evaluator/src/lib.rs
git commit -m "Coalesce identical ClickHouse queries within each evaluator batch"
```

---

### Task 6: Coalescing IT with a counting `RowQuerier` double

Proves identical SQL across two rules triggers exactly one `query_rows` call, and differing SQL triggers two. Uses a Postgres testcontainer (store), a Redis testcontainer (to mint real `JobId`s via `consume`), an in-memory `NoopBus`, and a counting ClickHouse double.

**Files:**
- Create: `crates/evaluator/tests/coalescing_it.rs`

- [ ] **Step 1: Write the IT `crates/evaluator/tests/coalescing_it.rs`**

```rust
use async_trait::async_trait;
use cc_clickhouse::{ChError, ResultRow, RowQuerier};
use cc_domain::ids::TenantId;
use cc_domain::instance::Status;
use cc_domain::rule::{RuleSpec, Severity};
use cc_domain::Event;
use cc_evaluator::process_batch;
use cc_queue::event_bus::RedisEventBus;
use cc_queue::redis_streams::RedisQueue;
use cc_queue::{EvalJob, EventBus, EventEntry, EventId, Queue, QueueError, TailCursor};
use cc_stores::PgStore;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

struct CountingCh {
    rows: Vec<ResultRow>,
    calls: AtomicUsize,
}

#[async_trait]
impl RowQuerier for CountingCh {
    async fn query_rows(
        &self,
        _sql: &str,
        _label_columns: &[String],
        _value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.rows.clone())
    }
}

struct NoopBus;

#[async_trait]
impl EventBus for NoopBus {
    async fn publish(&self, _ev: &Event) -> Result<(), QueueError> {
        Ok(())
    }
    async fn consume(&self, _c: &str, _n: usize, _b: usize) -> Result<Vec<EventEntry>, QueueError> {
        Ok(vec![])
    }
    async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
        Ok(())
    }
    async fn tail(
        &self,
        _cursor: &TailCursor,
        _n: usize,
        _b: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        Ok(vec![])
    }
    async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
        Ok(())
    }
}

fn spec(sql: &str) -> RuleSpec {
    RuleSpec {
        sql: sql.into(),
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec!["host".into()],
        value_column: Some("v".into()),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
    }
}

fn one_row() -> Vec<ResultRow> {
    let mut labels = BTreeMap::new();
    labels.insert("host".to_string(), "a".to_string());
    vec![ResultRow {
        labels,
        value: Some(1.0),
    }]
}

async fn pg() -> (
    PgStore,
    testcontainers_modules::testcontainers::ContainerAsync<Postgres>,
) {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    (store, node)
}

async fn redis_queue() -> (
    RedisQueue,
    testcontainers_modules::testcontainers::ContainerAsync<Redis>,
) {
    let node = Redis::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    let q = RedisQueue::connect(&format!("redis://127.0.0.1:{port}"))
        .await
        .unwrap();
    (q, node)
}

#[tokio::test]
async fn identical_sql_runs_one_query_both_rules_fire() {
    let (store, _pg) = pg().await;
    let (queue, _redis) = redis_queue().await;
    let tenant = TenantId(Uuid::new_v4());

    // Two distinct rules with identical query signatures.
    let r1 = store.create_rule(tenant, &spec("SELECT * FROM m")).await.unwrap();
    let r2 = store.create_rule(tenant, &spec("SELECT * FROM m")).await.unwrap();

    let now = OffsetDateTime::now_utc();
    for r in [&r1, &r2] {
        queue
            .enqueue(&EvalJob {
                tenant,
                rule: r.id,
                eval_ts: now,
            })
            .await
            .unwrap();
    }
    let deliveries = queue.consume("c1", 10, 1000).await.unwrap();
    assert_eq!(deliveries.len(), 2);

    let ch = CountingCh {
        rows: one_row(),
        calls: AtomicUsize::new(0),
    };
    let bus = NoopBus;
    let acked = process_batch(&store, &ch, &bus, deliveries).await;

    assert_eq!(acked.len(), 2, "both deliveries acked");
    assert_eq!(
        ch.calls.load(Ordering::SeqCst),
        1,
        "identical signatures must coalesce into one ClickHouse query"
    );

    // Both rules fired their one instance (for_secs = 0 → immediate firing).
    for r in [&r1, &r2] {
        let insts = store.load_instances(r.id).await.unwrap();
        assert_eq!(insts.len(), 1, "rule produced one instance");
        assert_eq!(insts[0].status, Status::Firing);
    }
}

#[tokio::test]
async fn differing_sql_runs_two_queries() {
    let (store, _pg) = pg().await;
    let (queue, _redis) = redis_queue().await;
    let tenant = TenantId(Uuid::new_v4());

    let r1 = store.create_rule(tenant, &spec("SELECT * FROM a")).await.unwrap();
    let r2 = store.create_rule(tenant, &spec("SELECT * FROM b")).await.unwrap();

    let now = OffsetDateTime::now_utc();
    for r in [&r1, &r2] {
        queue
            .enqueue(&EvalJob {
                tenant,
                rule: r.id,
                eval_ts: now,
            })
            .await
            .unwrap();
    }
    let deliveries = queue.consume("c1", 10, 1000).await.unwrap();
    assert_eq!(deliveries.len(), 2);

    let ch = CountingCh {
        rows: one_row(),
        calls: AtomicUsize::new(0),
    };
    let acked = process_batch(&store, &ch, &NoopBus, deliveries).await;
    assert_eq!(acked.len(), 2);
    assert_eq!(
        ch.calls.load(Ordering::SeqCst),
        2,
        "distinct signatures must each run their own query"
    );
}
```

- [ ] **Step 2: Run the IT**

Run: `cargo test -p cc-evaluator --test coalescing_it`
Expected: PASS — `identical_sql_runs_one_query_both_rules_fire` (1 call, both Firing) and `differing_sql_runs_two_queries` (2 calls).

> If `Status` is not re-exported at `cc_domain::instance::Status`, use the crate root path `cc_domain::Status` (confirmed exported in `crates/domain/src/lib.rs`). Adjust the import if the compiler flags it.

- [ ] **Step 3: Commit**

```bash
git add crates/evaluator/tests/coalescing_it.rs
git commit -m "Add IT proving within-batch query coalescing"
```

---

## Thread 1 — Scheduler tenant-sharding

### Task 7: Rendezvous (HRW) shard ownership

Pure, I/O-free shard assignment. Unit-tested without Docker.

**Files:**
- Create: `crates/scheduler/src/membership.rs`
- Modify: `crates/scheduler/src/lib.rs` (add `pub mod membership;`)

- [ ] **Step 1: Add the module declaration to `crates/scheduler/src/lib.rs`**

At the top of the file (after the existing `use` lines):

```rust
pub mod membership;
```

- [ ] **Step 2: Write `owned_shards` + `hash64` with failing unit tests in `crates/scheduler/src/membership.rs`**

```rust
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Deterministic weight of `(node_id, shard)` for rendezvous (HRW) hashing. Must be stable
/// across processes and replicas, so it uses `DefaultHasher` (fixed seed, unlike
/// `RandomState`) over the pair.
fn hash64(node_id: &str, shard: u32) -> u64 {
    let mut h = DefaultHasher::new();
    node_id.hash(&mut h);
    shard.hash(&mut h);
    h.finish()
}

/// Shards owned by `node_id` under rendezvous (HRW) hashing over the live `members`.
/// For each shard in `[0, shard_count)` the owner is the member with the highest
/// `hash64(member, shard)`, ties broken by lexicographically-smallest node id for
/// determinism. Returns the owned shard indices ascending. If `node_id` is not among
/// `members` (e.g. its heartbeat just expired), returns empty.
pub fn owned_shards(node_id: &str, members: &[String], shard_count: u32) -> Vec<i32> {
    if !members.iter().any(|m| m == node_id) {
        return Vec::new();
    }
    let mut owned = Vec::new();
    for shard in 0..shard_count {
        let mut best_node: &str = "";
        let mut best_w: u64 = 0;
        let mut first = true;
        for m in members {
            let w = hash64(m, shard);
            if first || w > best_w || (w == best_w && m.as_str() < best_node) {
                best_node = m.as_str();
                best_w = w;
                first = false;
            }
        }
        if best_node == node_id {
            owned.push(shard as i32);
        }
    }
    owned
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn members(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn single_member_owns_all_shards() {
        assert_eq!(owned_shards("n1", &members(&["n1"]), 8), (0..8).collect::<Vec<i32>>());
    }

    #[test]
    fn non_member_owns_nothing() {
        assert!(owned_shards("nx", &members(&["n1", "n2"]), 8).is_empty());
    }

    #[test]
    fn partition_is_total_and_disjoint() {
        let ms = members(&["n1", "n2", "n3"]);
        let mut union = HashSet::new();
        for n in ["n1", "n2", "n3"] {
            for s in owned_shards(n, &ms, 256) {
                assert!(union.insert(s), "shard {s} owned by more than one node");
            }
        }
        assert_eq!(union.len(), 256, "every shard owned by exactly one node");
    }

    #[test]
    fn deterministic_across_calls() {
        let ms = members(&["a", "b", "c"]);
        assert_eq!(owned_shards("b", &ms, 256), owned_shards("b", &ms, 256));
    }

    #[test]
    fn adding_member_only_moves_shards_to_new_node() {
        let two = members(&["n1", "n2"]);
        let three = members(&["n1", "n2", "n3"]);
        let n1_two: HashSet<i32> = owned_shards("n1", &two, 256).into_iter().collect();
        let n1_three: HashSet<i32> = owned_shards("n1", &three, 256).into_iter().collect();
        // HRW invariant: adding n3 can only TAKE shards from n1, never give it new ones.
        assert!(n1_three.is_subset(&n1_two));
    }

    #[test]
    fn balance_is_roughly_even() {
        let ms = members(&["n1", "n2", "n3", "n4"]);
        for n in ["n1", "n2", "n3", "n4"] {
            let c = owned_shards(n, &ms, 256).len();
            // expected 64; very loose bound to avoid flakiness.
            assert!((32..=96).contains(&c), "node {n} owns {c} shards, expected ~64");
        }
    }
}
```

- [ ] **Step 3: Run to verify the tests pass**

Run: `cargo test -p cc-scheduler --lib`
Expected: PASS — all six ownership tests green.

- [ ] **Step 4: Clippy**

Run: `cargo clippy -p cc-scheduler --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/scheduler/src/membership.rs crates/scheduler/src/lib.rs
git commit -m "Add rendezvous-hashing shard ownership for the scheduler"
```

---

### Task 8: Redis membership heartbeat registry

**Files:**
- Modify: `crates/scheduler/Cargo.toml`
- Modify: `crates/scheduler/src/membership.rs`
- Create: `crates/scheduler/tests/membership_it.rs`

- [ ] **Step 1: Add deps to `crates/scheduler/Cargo.toml`**

Under `[dependencies]` add:

```toml
redis.workspace = true
```

Add a `[dev-dependencies]` section:

```toml
[dev-dependencies]
testcontainers.workspace = true
testcontainers-modules.workspace = true
```

- [ ] **Step 2: Add the `MembershipRegistry` to `crates/scheduler/src/membership.rs`**

At the top of the file, add imports:

```rust
use redis::aio::ConnectionManager;
use redis::Script;
```

Add above the `#[cfg(test)]` module:

```rust
const MEMBERS_KEY: &str = "cc:scheduler:members";

// Refresh this node's heartbeat (score = Redis server time in ms, so all replicas agree
// on "now"), evict members older than ttl_ms, and return the live member set.
const HEARTBEAT_LUA: &str = r#"
local t = redis.call('TIME')
local now_ms = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZADD', KEYS[1], now_ms, ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now_ms - tonumber(ARGV[2]))
return redis.call('ZRANGE', KEYS[1], 0, -1)
"#;

/// Redis-backed scheduler membership. A sorted set `cc:scheduler:members` maps node id →
/// last-heartbeat (Redis server clock). Leaderless: every replica heartbeats and reads the
/// same live set, then computes its shards via [`owned_shards`].
pub struct MembershipRegistry {
    conn: ConnectionManager,
}

impl MembershipRegistry {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self { conn })
    }

    /// Refresh `node_id`'s heartbeat and return the live members (heartbeat within
    /// `ttl_ms`), evicting stale ones. Atomic via a single Lua script.
    pub async fn heartbeat(&self, node_id: &str, ttl_ms: u64) -> anyhow::Result<Vec<String>> {
        let mut conn = self.conn.clone();
        let members: Vec<String> = Script::new(HEARTBEAT_LUA)
            .key(MEMBERS_KEY)
            .arg(node_id)
            .arg(ttl_ms as i64)
            .invoke_async(&mut conn)
            .await?;
        Ok(members)
    }
}
```

- [ ] **Step 3: Write the membership IT `crates/scheduler/tests/membership_it.rs`**

```rust
use cc_scheduler::membership::MembershipRegistry;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;

async fn registry() -> (
    String,
    testcontainers_modules::testcontainers::ContainerAsync<Redis>,
) {
    let node = Redis::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    (format!("redis://127.0.0.1:{port}"), node)
}

#[tokio::test]
async fn heartbeat_registers_and_lists_live_members() {
    let (url, _node) = registry().await;
    let reg = MembershipRegistry::connect(&url).await.unwrap();

    let m = reg.heartbeat("n1", 10_000).await.unwrap();
    assert_eq!(m, vec!["n1".to_string()]);

    let reg2 = MembershipRegistry::connect(&url).await.unwrap();
    reg2.heartbeat("n2", 10_000).await.unwrap();

    let mut m = reg.heartbeat("n1", 10_000).await.unwrap();
    m.sort();
    assert_eq!(m, vec!["n1".to_string(), "n2".to_string()]);
}

#[tokio::test]
async fn stale_members_are_evicted_after_ttl() {
    let (url, _node) = registry().await;
    let reg = MembershipRegistry::connect(&url).await.unwrap();

    // n2 heartbeats once with a 1ms TTL, then never again.
    reg.heartbeat("n2", 1).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // n1 heartbeats (also 1ms TTL): n2's score is now > 1ms old → evicted; n1 just added.
    let m = reg.heartbeat("n1", 1).await.unwrap();
    assert_eq!(m, vec!["n1".to_string()], "stale n2 must be evicted");
}
```

- [ ] **Step 4: Run the IT**

Run: `cargo test -p cc-scheduler --test membership_it`
Expected: PASS — registration/listing and TTL eviction both green.

Run: `cargo clippy -p cc-scheduler --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/scheduler/Cargo.toml crates/scheduler/src/membership.rs crates/scheduler/tests/membership_it.rs
git commit -m "Add Redis heartbeat membership registry for the scheduler"
```

---

### Task 9: `claim_due_rules_sharded` store method

**Files:**
- Modify: `crates/stores/src/pg.rs`
- Create: `crates/stores/tests/sharding_it.rs`

- [ ] **Step 1: Write the failing IT `crates/stores/tests/sharding_it.rs`**

```rust
use cc_domain::ids::TenantId;
use cc_domain::rule::{RuleSpec, Severity};
use cc_stores::PgStore;
use std::collections::{BTreeMap, HashSet};
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

fn spec() -> RuleSpec {
    RuleSpec {
        sql: "SELECT 1".into(),
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec![],
        value_column: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
    }
}

async fn store() -> (
    PgStore,
    testcontainers_modules::testcontainers::ContainerAsync<Postgres>,
) {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    (store, node)
}

#[tokio::test]
async fn sharded_claim_partitions_without_loss_or_overlap() {
    let (store, _node) = store().await;
    let mut all = HashSet::new();
    for _ in 0..50 {
        let t = TenantId(Uuid::new_v4());
        all.insert(store.create_rule(t, &spec()).await.unwrap().id.0);
    }
    let now = OffsetDateTime::now_utc() + Duration::seconds(1);
    let n = 256;
    let lo: Vec<i32> = (0..128).collect();
    let hi: Vec<i32> = (128..256).collect();

    let a = store.claim_due_rules_sharded(now, 1000, &lo, n).await.unwrap();
    let b = store.claim_due_rules_sharded(now, 1000, &hi, n).await.unwrap();

    let mut union = HashSet::new();
    for r in a.iter().chain(b.iter()) {
        assert!(union.insert(r.id.0), "rule {} claimed by both shard halves", r.id.0);
    }
    assert_eq!(union, all, "every due rule claimed exactly once across the partition");
}

#[tokio::test]
async fn full_shard_set_claims_all_rules() {
    let (store, _node) = store().await;
    let mut ids = HashSet::new();
    for _ in 0..20 {
        let t = TenantId(Uuid::new_v4());
        ids.insert(store.create_rule(t, &spec()).await.unwrap().id.0);
    }
    let now = OffsetDateTime::now_utc() + Duration::seconds(1);
    let all: Vec<i32> = (0..256).collect();
    let claimed = store.claim_due_rules_sharded(now, 1000, &all, 256).await.unwrap();
    let got: HashSet<_> = claimed.iter().map(|r| r.id.0).collect();
    assert_eq!(got, ids);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p cc-stores --test sharding_it`
Expected: FAIL — `no method named claim_due_rules_sharded`.

- [ ] **Step 3: Add `claim_due_rules_sharded` to `crates/stores/src/pg.rs`**

Immediately after the existing `claim_due_rules` method:

```rust
    /// Like [`Self::claim_due_rules`], but only claims rules whose tenant hashes into
    /// `owned_shards` under the fixed `shard_count` shard space. Lets multiple scheduler
    /// replicas claim disjoint tenant slices concurrently. The tenant→shard hash mirrors
    /// the HRW layer's input and is non-negative: `((hashtext(tenant) % N) + N) % N`.
    pub async fn claim_due_rules_sharded(
        &self,
        now: OffsetDateTime,
        limit: i64,
        owned_shards: &[i32],
        shard_count: i32,
    ) -> Result<Vec<Rule>, StoreError> {
        let rows = sqlx::query(
            "WITH due AS (
                SELECT id FROM rules
                WHERE next_eval <= $1
                  AND ((((hashtext(tenant::text)::bigint % $3) + $3) % $3))::int = ANY($4)
                ORDER BY next_eval LIMIT $2 FOR UPDATE SKIP LOCKED
             )
             UPDATE rules r
             SET next_eval = $1 + make_interval(secs => (r.spec->>'interval_secs')::int)
             FROM due WHERE r.id = due.id
             RETURNING r.id, r.tenant, r.spec, r.version",
        )
        .bind(now)
        .bind(limit)
        .bind(shard_count)
        .bind(owned_shards)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::new();
        for r in rows {
            let spec: RuleSpec = serde_json::from_value(r.get("spec"))?;
            out.push(Rule {
                id: RuleId(r.get("id")),
                tenant: TenantId(r.get("tenant")),
                spec,
                version: r.get("version"),
            });
        }
        Ok(out)
    }
```

- [ ] **Step 4: Run the IT to verify it passes**

Run: `cargo test -p cc-stores --test sharding_it`
Expected: PASS — partition test and full-set test both green.

Run: `cargo clippy -p cc-stores --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/stores/src/pg.rs crates/stores/tests/sharding_it.rs
git commit -m "Add claim_due_rules_sharded for tenant-sharded scheduling"
```

---

### Task 10: Rewire `run_scheduler` + config + main

Replaces the singleton lease with the membership heartbeat → HRW → sharded claim, and wires config. `run_scheduler` has no test caller (only `src/main.rs`), so this is guarded by build + clippy + the workspace gate.

**Files:**
- Modify: `crates/scheduler/src/lib.rs`
- Modify: `src/config.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Rewrite `crates/scheduler/src/lib.rs`**

Replace the entire file with:

```rust
use cc_queue::{EvalJob, Queue};
use cc_stores::PgStore;
use std::sync::Arc;
use std::time::Duration;
use time::OffsetDateTime;
use tokio::sync::watch;

pub mod membership;

use membership::{owned_shards, MembershipRegistry};

/// Run the sharded scheduler until `shutdown` resolves. Each tick: refresh this node's
/// heartbeat, compute its owned shards via rendezvous hashing over the live membership,
/// and enqueue due rules for those shards. With `shard_count == 1` exactly one replica
/// owns the single shard (leaderless auto-failover singleton); raising it parallelizes.
#[allow(clippy::too_many_arguments)]
pub async fn run_scheduler(
    store: PgStore,
    queue: Arc<dyn Queue>,
    registry: MembershipRegistry,
    node_id: String,
    shard_count: u32,
    member_ttl_ms: u64,
    tick: Duration,
    batch: i64,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }

        match registry.heartbeat(&node_id, member_ttl_ms).await {
            Ok(members) => {
                let owned = owned_shards(&node_id, &members, shard_count);
                if owned.is_empty() {
                    tracing::debug!("scheduler owns no shards this tick");
                } else if let Err(e) =
                    tick_once(&store, queue.as_ref(), batch, &owned, shard_count as i32).await
                {
                    tracing::error!(error = %e, "scheduler tick failed");
                }
            }
            Err(e) => tracing::error!(error = %e, "membership heartbeat failed"),
        }

        tokio::select! {
            _ = tokio::time::sleep(tick) => {}
            _ = shutdown.changed() => {}
        }
    }
    tracing::info!("scheduler stopped");
}

async fn tick_once(
    store: &PgStore,
    queue: &dyn Queue,
    batch: i64,
    owned_shards: &[i32],
    shard_count: i32,
) -> anyhow::Result<()> {
    let now = OffsetDateTime::now_utc();
    let due = store
        .claim_due_rules_sharded(now, batch, owned_shards, shard_count)
        .await?;
    for rule in due {
        let job = EvalJob {
            tenant: rule.tenant,
            rule: rule.id,
            eval_ts: now,
        };
        queue.enqueue(&job).await?;
    }
    Ok(())
}
```

- [ ] **Step 2: Add config fields in `src/config.rs`**

Add to the `Config` struct:

```rust
    pub scheduler_shards: u32,
    pub scheduler_member_ttl_ms: u64,
```

In `from_env`, inside the `Config { ... }` literal (after `node_id`):

```rust
            scheduler_shards: var("CC_SCHEDULER_SHARDS", "1").parse().unwrap_or(1),
            scheduler_member_ttl_ms: var("CC_SCHEDULER_MEMBER_TTL_MS", "10000")
                .parse()
                .unwrap_or(10_000),
```

- [ ] **Step 3: Rewire the scheduler block in `src/main.rs`**

Add the import near the other `cc_scheduler` import:

```rust
use cc_scheduler::membership::MembershipRegistry;
```

Replace the `if run("scheduler") { ... }` block with:

```rust
    if run("scheduler") {
        let registry = MembershipRegistry::connect(&cfg.redis_url).await?;
        let store = store.clone();
        let queue = queue.clone();
        let rx = sd_rx.clone();
        let node_id = cfg.node_id.clone();
        let shards = cfg.scheduler_shards;
        let ttl = cfg.scheduler_member_ttl_ms;
        handles.push(tokio::spawn(async move {
            run_scheduler(
                store,
                queue,
                registry,
                node_id,
                shards,
                ttl,
                Duration::from_secs(1),
                500,
                rx,
            )
            .await;
        }));
    }
```

(The `cc:maintenance:lease` block under `run("evaluator")` and the `use cc_stores::{PgStore, RedisLease};` import are unchanged — `RedisLease` is still used for maintenance.)

- [ ] **Step 4: Build + clippy + full workspace gate**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: clean (no remaining references to the removed scheduler lease).

Run: `cargo build`
Expected: success.

Run: `cargo test --workspace --no-fail-fast`
Expected: PASS — all unit/IT/e2e suites green (Docker required).

- [ ] **Step 5: Format**

Run: `cargo fmt --all`
Then: `cargo fmt --all -- --check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add crates/scheduler/src/lib.rs src/config.rs src/main.rs
git commit -m "Shard the scheduler via membership heartbeat; remove the singleton lease"
```

---

## Final Review

After all tasks: dispatch a final code reviewer over the whole `feat/phase3c-scale` diff, then use **superpowers:finishing-a-development-branch**.

**Final gates (must all pass):**

```bash
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace --no-fail-fast
```

**Spec-coverage checklist:**
- Thread 1: HRW `owned_shards` (Task 7) ✓; Redis heartbeat registry (Task 8) ✓; `claim_due_rules_sharded` (Task 9) ✓; `run_scheduler` rewire + `CC_SCHEDULER_SHARDS`/`CC_SCHEDULER_MEMBER_TTL_MS` defaults + lease removal (Task 10) ✓.
- Thread 2: `RowQuerier` seam (Task 4) ✓; within-batch coalescing by `(sql,label_columns,value_column)` (Task 5) ✓; counting-double IT (Task 6) ✓.
- Thread 3: `JobId`/`EventId` newtypes (Task 1) ✓; `TailCursor` replacing `"$"` (Task 2) ✓; conformance suite + Backend-contract docs (Task 3) ✓.
- Back-compat: no migration; single-replica degenerates to today (`N=1` → one owner); coalescing transparent; mixed-version rolling deploy harmless under existing idempotency (documented in spec).
