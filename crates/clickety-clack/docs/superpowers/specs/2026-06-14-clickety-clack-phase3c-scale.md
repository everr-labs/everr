# Clickety-Clack Phase 3C — Scale & Portability (Design Spec)

**Date:** 2026-06-14
**Status:** Approved for planning
**Predecessor:** Phase 3B (durability hardening) merged to main (`0490c7c`).

## Context

Clickety-clack is a headless Rust alerting system on ClickHouse (Prometheus-class
evaluation + Alertmanager-class dispatch), multi-tenant SaaS. Postgres is the durable
store; Redis Streams is the hot path. Phase 3 was decomposed into four
independently-shippable sub-projects:

- **3A — Silences + Inhibition** — DONE (`3b5b6d0`).
- **3B — Durability hardening** — DONE (`0490c7c`).
- **3C — Scale & portability** — THIS SPEC.
- **3D — Secret encryption-at-rest** — channel-config secrets encrypted in Postgres.
  NOT STARTED.

## Goal

Let the system scale horizontally and stay backend-portable, via three independent
threads shipped together:

1. **Scheduler tenant-sharding** — multiple scheduler replicas run concurrently, each
   owning a slice of a fixed shard space, replacing today's single lease-holder.
2. **Identical-query coalescing** — within an evaluator consume batch, rules sharing the
   same ClickHouse query issue a single round-trip.
3. **Kafka-ready seam hardening** — seal Redis-specific details out of the
   `Queue`/`EventBus` traits and their callers, and prove the contract with a
   backend-agnostic conformance suite. No Kafka code or dependency in this phase.

All three preserve existing behavior in the single-replica / no-duplicate-query /
Redis-only case.

## Decisions (locked during brainstorming)

1. **All three threads in one 3C spec.**
2. **Kafka = harden the seam only.** No `KafkaQueue`/`KafkaEventBus` implementation, no
   Kafka dependency. The deliverable is a trait/caller refactor plus a conformance test
   suite that a future Kafka backend must pass.
3. **Scheduler sharding = dynamic membership with rebalancing**, implemented as leaderless
   rendezvous (HRW) hashing over a Redis heartbeat registry (no separate coordinator
   process). **Default shard count = 1** — a leaderless auto-failover singleton; sharding
   (parallelism) is strictly opt-in by raising `CC_SCHEDULER_SHARDS`.
4. **Coalescing scope = within-batch** (no added latency, no cross-batch buffering).

---

## Thread 1 — Scheduler tenant-sharding

### Today

`run_scheduler` (`crates/scheduler/src/lib.rs`) holds `cc:scheduler:lease` (a `RedisLease`
singleton) so exactly one replica runs `tick_once`, which calls
`store.claim_due_rules(now, batch)` across **all** tenants and enqueues a per-rule
`EvalJob`. Throughput is bounded by that one replica.

### Design

Replace the singleton lease with **leaderless membership**: every scheduler replica runs,
and each owns a deterministic slice of a fixed shard space.

**Two independent hash layers:**

- **Tenant → shard (SQL, stable).** `N` fixed shards, **default `N = 1`**. A tenant maps
  to shard `((hashtext(tenant::text)::bigint % N) + N) % N` (the `+N then %N` makes it
  non-negative; `hashtext` returns a possibly-negative `int4`). At the `N = 1` default
  every tenant maps to shard 0, so HRW elects exactly one owner — a leaderless,
  self-electing singleton (see below). Operators who need parallel scheduling raise `N`
  to `≈ 8–16×` their max replica count so HRW balance is fine-grained.
- **Shard → replica (Rust, dynamic).** Rendezvous / highest-random-weight (HRW) hashing.
  For each shard `s ∈ [0, N)`, its owner is the live member maximizing
  `hash64(node_id, s)`. A replica owns `s` iff it is that argmax. HRW gives an even spread
  and moves only ~`1/M` of shards when a replica joins or leaves (M = member count).

**Membership registry (Redis, Lua-driven, mirrors `crates/queue/src/groups.rs`).** A
sorted set `cc:scheduler:members` with score = heartbeat time. Each tick a single Lua
script runs atomically and uses the Redis server `TIME` command (not the replica's clock,
to avoid cross-replica skew):

1. `ZADD cc:scheduler:members <server_now_ms> <node_id>` — refresh own heartbeat.
2. `ZREMRANGEBYSCORE cc:scheduler:members -inf <server_now_ms - ttl_ms>` — evict dead
   members.
3. `ZRANGE cc:scheduler:members 0 -1` — return the live member set.

The replica then computes its owned shards via HRW over the returned live set and calls
the new sharded claim.

**New store method:**

```rust
pub async fn claim_due_rules_sharded(
    &self,
    now: OffsetDateTime,
    limit: i64,
    owned_shards: &[i32],
    shard_count: i32,
) -> Result<Vec<Rule>, StoreError>
```

Identical to `claim_due_rules` (same CTE, `FOR UPDATE SKIP LOCKED`, `next_eval`
advance) plus an added predicate in the `due` CTE:

```sql
AND (((hashtext(tenant::text)::bigint % $shard_count) + $shard_count) % $shard_count)
    = ANY($owned_shards)
```

The existing `claim_due_rules` is retained (used by any non-sharded path / tests) but the
scheduler now calls the sharded variant.

**Safety during rebalance.** A stale membership view can briefly let two replicas both
believe they own shard `s` → double-enqueue. This is already harmless:
`claim_due_rules_sharded` uses `FOR UPDATE SKIP LOCKED` and advances `next_eval` in the
same statement (only one claimer wins a given row), and `try_claim_eval` dedups again at
evaluation time `(rule, eval_ts)`. A momentary gap (no live owner for a shard) self-heals
on the next tick; `next_eval` slips by at most one tick.

**Default = leaderless singleton (`N = 1`).** With one shard, HRW picks exactly one
replica to own shard 0; it claims all tenants and the rest idle as hot standbys. This is
operationally identical to today's single scheduler, but failover is automatic (the
owner's heartbeat expires → another replica wins shard 0 within one TTL) and there is no
shard math to reason about. Adding replicas at `N = 1` buys **HA/failover, not
throughput** — to parallelize, raise `N`. This makes sharding strictly opt-in: a small or
careless deployment pays no extra `claim_due_rules` DB load and needs no tuning.

**Degenerate case preserved at any `N`.** A single replica wins all `N` shards → claims
all tenants → exactly today's behavior, regardless of the configured shard count.

### Module layout

- New `crates/scheduler/src/membership.rs`:
  - `heartbeat(&self, node_id, ttl_ms) -> Result<Vec<String>, _>` — runs the Lua script,
    returns live members. (Holds a Redis connection/client; constructed once.)
  - `owned_shards(node_id: &str, members: &[String], shard_count: u32) -> Vec<i32>` —
    pure HRW computation, unit-testable with no I/O.
  - `hash64(node_id: &str, shard: u32) -> u64` — stable, deterministic mix (e.g. a fixed
    `std` hasher seeded by the two inputs; the only requirement is determinism across
    replicas and a good spread).
- `crates/scheduler/src/lib.rs`: `run_scheduler` loses the `lease: RedisLease` parameter
  and gains `node_id: String`, `shard_count: u32`, `member_ttl_ms: u64`, plus a handle to
  the membership registry. Each tick: heartbeat → `owned_shards` → `claim_due_rules_sharded`
  → enqueue. The `tokio::select!` shutdown/tick structure is unchanged.

`cc:scheduler:lease` is removed entirely.

---

## Thread 2 — Identical-query coalescing (within-batch)

### Today

`run_evaluator` (`crates/evaluator/src/lib.rs`) consumes a batch (up to 16 deliveries),
then loops calling `process()` per delivery — each issuing its own
`ch.query_rows(rule.spec.sql, rule.spec.label_columns, rule.spec.value_column)`. Rules
with identical SQL hit ClickHouse once each.

### Design

Insert a coalescing step over the consume batch.

**Query signature.** Two jobs share a ClickHouse round-trip iff their
`(sql, label_columns, value_column)` tuple is identical. That tuple fully determines both
the wire query and how rows are parsed, so the resulting `Vec<Row>` is reusable verbatim.
The signature is a hashable key built from those three fields of `rule.spec`.

**Restructured batch flow (replacing the per-delivery `process()` loop):**

1. **Claim + resolve (per-job, unchanged semantics).** For each delivery: `try_claim_eval`
   (idempotency) and `get_rule`. Drop jobs whose rule was deleted or already claimed.
   Claiming stays per-job so dedup behavior is identical to today.
2. **Group** the surviving `(delivery, rule)` pairs by query signature.
3. **Run each distinct query once** via `ch.query_rows(...)`, producing a shared
   `Vec<Row>`. A query error fails only the jobs in that group (each gets
   `record_eval_error` + ack, exactly as today's error path); other groups are unaffected.
4. **Fan out.** For each rule in the group, run the existing present-set /
   known-instance evaluation against the shared rows, then `publish_transition`. The
   per-rule logic is byte-identical — only the *source* of rows is now shared.
5. **Ack** each delivery on success (per-job, unchanged).

**Refactor.** Today's `process()` body splits:

- `evaluate_rule_against_rows(store, events, rule, job, rows) -> anyhow::Result<()>` — the
  existing per-rule evaluation (present-set build, absence path, `publish_transition`),
  taking pre-fetched rows instead of querying.
- Batch orchestration (claim, group, query-once, fan-out, ack) lives in the consume loop
  / a `process_batch` helper.

`try_claim_eval`, the absence path, and all outbox/publish behavior are unchanged.

**Concurrency note (implementation detail, not a semantic change).** Distinct
signature-groups' `query_rows` calls may run concurrently (bounded) to preserve batch
latency; correctness does not depend on it.

**Why within-batch suffices.** The scheduler enqueues all due rules of a given interval on
the same tick, so identical queries naturally arrive in the same consume window. This
captures the common case with zero added latency and no new buffering layer.

---

## Thread 3 — Kafka-ready seam hardening

Goal: a future `KafkaQueue` / `KafkaEventBus` could be dropped in **without touching any
caller**. No Kafka code or dependency in this phase. Two Redis leaks are sealed and one
artifact proves the contract.

### 1. Remove the `"$"` tail sentinel (the real leak)

`EventBus::tail(last_id: &str, …)` forces callers to know Redis's `"$"` = live-tail
convention — `crates/api/src/sse_pump.rs:15` hardcodes `"$"` and treats the cursor as a
raw string. Replace with a typed cursor:

```rust
pub enum TailCursor {
    Live,            // start at "whatever is current" (Redis "$"; Kafka latest offset)
    After(EventId),  // strictly after this position
}
```

Signature becomes `tail(cursor: &TailCursor, count, block_ms) -> Result<Vec<EventEntry>, _>`.
The SSE pump starts with `TailCursor::Live` and advances with
`TailCursor::After(entry.id.clone())`. The Redis impl maps `Live → "$"`, `After(id) → id`
internally; a Kafka impl maps `Live → latest offset`, `After → that offset`. No caller
change required to swap backends.

### 2. Seal message IDs behind newtypes

Raw `id: String` on `Delivery` / `EventEntry` invites string ops and sentinel
construction. Introduce opaque newtypes:

```rust
pub struct JobId(String);    // Delivery.id
pub struct EventId(String);  // EventEntry.id
```

Each derives `Debug, Clone, PartialEq, Eq` and implements `Display` (for tracing). No
public parsing or ordering beyond equality, and construction is crate-internal to the
`queue` crate (impls produce them; callers only move them around). `Queue::ack` /
`EventBus::ack` take the corresponding id type. Caller changes (`dispatcher` ack, SSE
cursor advance) are mechanical.

### 3. Document and prove the contract — backend-conformance suite

Add `crates/queue/tests/conformance.rs`: a **backend-agnostic** harness — generic helper
functions parameterized over `Arc<dyn Queue>` / `Arc<dyn EventBus>` — asserting the
behavioral contract every backend must satisfy:

- **Queue:** enqueue → consume returns the job; ack removes it from redelivery; an unacked
  delivery is redelivered (to the same or another consumer); at-least-once holds.
- **EventBus:** publish → shared-group `consume` delivers once-acked-once-gone;
  `tail(Live)` then publish → the tail sees the post-`Live` event; `tail(After(id))`
  resumes strictly after `id`; `dead_letter` records on the dead-letter stream.

The Redis `RedisQueue` / `RedisEventBus` run through this suite now. When a Kafka backend
is added later, it runs the **same** suite. The `Queue` / `EventBus` trait docs gain a
"Backend contract" section stating these guarantees in prose, so the suite and the docs
cannot drift.

### Scope guard (YAGNI)

No change to ack granularity (per-message id-ack maps cleanly to Redis `XACK` and to a
Kafka offset-commit-per-message). No partitioning API, no consumer-rebalance hooks, no
Kafka dependency. Just the cursor type, the id newtypes, and the conformance suite + docs.

---

## Configuration

`src/config.rs` (env-driven, with defaults):

- `CC_SCHEDULER_SHARDS` — fixed shard count `N`. **Default `1`** (leaderless singleton:
  HA failover, no parallelism). Raise to `≈ 8–16×` your max scheduler replica count to
  parallelize scheduling. **Must be identical across all scheduler replicas** (it is part
  of the tenant→shard hash); documented as such.
- `CC_SCHEDULER_MEMBER_TTL_MS` — membership heartbeat TTL. Default `10000`.

`node_id` already exists and becomes the membership identity. No new config for coalescing
or the seam hardening.

## Wiring (`src/main.rs`)

The `run("scheduler")` block drops the `RedisLease::connect(..., "cc:scheduler:lease", ...)`
acquisition and instead constructs the membership registry (Redis client) and passes
`node_id`, `shard_count`, `member_ttl_ms` into `run_scheduler`. The evaluator, the 3B
`cc:maintenance:lease`, the dispatcher, and the group-flusher are untouched.

## Testing

**Unit (no Docker):**

- HRW ownership (`owned_shards`): deterministic for a fixed `(node_id, members, N)`; union
  of all members' owned shards == `[0, N)` with no overlap; even-ish distribution; adding
  or removing one member moves ≤ ~`1/M` of shards (minimal-reshuffle property).
- Query-signature grouping: identical `(sql, label_columns, value_column)` tuples coalesce
  into one group; any differing field separates groups; `value_column` `Some`/`None`
  distinction respected.

**Store IT (testcontainers Postgres):**

- `claim_due_rules_sharded` returns only rules whose tenant maps into the owned-shard set.
- Partitioning correctness: for a set of rules, the union of results over a disjoint shard
  partition equals the unsharded `claim_due_rules` result — no rule dropped, none claimed
  by two disjoint shard sets.

**Membership IT (testcontainers Redis):**

- Heartbeat Lua adds self and returns it in the live set; two node_ids → both present; a
  node that stops heartbeating is evicted after TTL (`ZREMRANGEBYSCORE`).

**Evaluator IT (Postgres + Redis + a counting ClickHouse double):**

- A batch of two rules with identical SQL triggers exactly **one** `query_rows` call yet
  both rules transition correctly; two rules with different SQL → two calls. (Requires a
  `ChClient` seam that can be substituted by a counting fake; if `ChClient` is currently
  concrete, introduce a minimal trait/seam for the row-query call as part of this thread.)

**Conformance suite (testcontainers Redis):** the Thread-3 backend-agnostic harness, green
against `RedisQueue` / `RedisEventBus`.

**e2e / regression:** existing `tests/` stay green unchanged — sharding degenerates to
all-shards on a single node, coalescing is transparent, and the cursor / id-newtype
changes are mechanical.

## Backward compatibility & rollout

- **No schema migration.** Sharding is a query predicate; no new tables or columns.
- **Mixed-version deploy.** Removing `cc:scheduler:lease` means that during a rolling
  upgrade an old singleton replica and new sharded replicas may both enqueue briefly. This
  is harmless under existing idempotency (`FOR UPDATE SKIP LOCKED` + `try_claim_eval`) and
  converges once all replicas are on 3C. **Documented trade-off.**
- **Shard-count change** requires a coordinated restart of all scheduler replicas (it
  changes the tenant→shard mapping); a transient mismatch only causes harmless
  double/again-deduped enqueues, never lost evaluations.

## Out of scope (deferred)

- Actual Kafka backend implementation (this phase only hardens the seam).
- Cross-batch or global single-flight query coalescing (within-batch only).
- Redis pub/sub cache invalidation for the 3A `FilterCache` and routing/receiver caches.
- Single-flight on cache reload.
- Secret encryption-at-rest (Phase 3D).

## Conventions

Rust workspace; TDD bite-sized steps with complete code; Docker-backed testcontainers
Postgres + Redis integration tests; `cargo clippy --all-targets -- -D warnings` clean;
`cargo fmt --all -- --check` clean; real gate `cargo test --workspace --no-fail-fast`;
package disambiguation `-p cc@0.1.0`. No Claude/AI attribution anywhere in commits, PRs,
or code.
