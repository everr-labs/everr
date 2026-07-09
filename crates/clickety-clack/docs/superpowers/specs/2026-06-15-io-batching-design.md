# Postgres/Redis I/O Batching — Design

**Status:** Approved (design phase)
**Date:** 2026-06-15
**Goal:** Cut the per-rule Postgres round-trips in the evaluator and overlap the per-event
Redis round-trips in the dispatcher, raising sustained throughput on the two I/O-bound hot
paths the load harness identified (~337 rules/sec, ~5766 events/sec).

---

## 1. Motivation

The load harness (`docs/load-testing.md`) showed both hot paths are I/O-bound, not CPU-bound:

- **Evaluator** ~337 rules/sec. A rule with N result rows does **N separate single-row
  `upsert_instance` round-trips**, plus a 4-round-trip transaction per *transition*
  (`upsert_instance_with_outbox`: BEGIN → upsert → outbox insert → COMMIT). At steady state
  the N upserts are ~87% of the per-rule round-trips; during an alert storm the per-transition
  transactions dominate.
- **Dispatcher** ~5766 events/sec. `run_dispatcher` consumes a batch of 16 events and processes
  them **sequentially** (`for entry in entries`), so the independent per-event Redis round-trips
  (`add_to_group`, already a single atomic Lua script) never overlap.

Two phases, evaluator first.

## 2. Phase 1 — Evaluator: batch the whole persistence path

### 2a. New store method `persist_eval_batch`

```rust
/// Persist a batch of next-states and, atomically, an outbox row per event — in ONE
/// transaction. Returns the outbox ids (aligned with `events`) for the publish-then-delete
/// dance. Empty `instances` is a no-op returning an empty Vec.
pub async fn persist_eval_batch(
    &self,
    instances: &[InstanceState],   // ALL next-states for the rule's evaluation
    events: &[Event],              // the subset that produced a transition
) -> Result<Vec<Uuid>, StoreError>
```

One transaction:

1. `BEGIN`
2. Multi-row instance upsert via Postgres array `unnest` (fixed 9 params regardless of N):
   ```sql
   INSERT INTO instances (key, rule, tenant, status, labels, value, active_since, last_seen, absent_count)
   SELECT * FROM unnest($1::text[], $2::uuid[], $3::text[], $4::text[], $5::jsonb[],
                        $6::float8[], $7::timestamptz[], $8::timestamptz[], $9::int[])
   ON CONFLICT (key) DO UPDATE SET
     status=EXCLUDED.status, labels=EXCLUDED.labels, value=EXCLUDED.value,
     active_since=EXCLUDED.active_since, last_seen=EXCLUDED.last_seen, absent_count=EXCLUDED.absent_count
   ```
   `value`, `active_since`, `last_seen` are nullable → bind `Vec<Option<…>>`; `unnest` carries
   NULLs correctly. This mirrors the existing single-row `upsert_instance` column set exactly.
3. Multi-row outbox insert (only if `events` is non-empty); one row per event, each with a
   freshly generated `Uuid`, mirroring the existing `event_outbox (id, tenant, payload)` insert.
4. `COMMIT`, returning the generated outbox ids in `events` order.

Chunking safeguard: if `instances.len()` exceeds a cap (`PERSIST_BATCH_MAX`, e.g. 1000), split
into successive transactions of that size. Still far cheaper than N single-row transactions.
Default path is one transaction.

### 2b. Rewire `evaluate_rule_against_rows`

Replace the per-instance `publish_transition` calls with collect-then-batch:

```rust
let mut instances: Vec<InstanceState> = Vec::new();
let mut events: Vec<Event> = Vec::new();
// present loop:
for (key, (labels, value)) in present {
    let prev = known_keys.remove(&key).unwrap_or_else(|| InstanceState::new_inactive(...));
    let out = evaluate(prev, input);
    if let Some(ev) = out.event { events.push(ev); }
    instances.push(out.next);
}
// absent loop: same shape (push out.next; push out.event if Some)
let outbox_ids = store.persist_eval_batch(&instances, &events).await?;
// publish each event; on success delete its outbox row (batch the deletes)
```

Publish + cleanup after commit:
- For each `(event, outbox_id)`: `events_bus.publish(event)`; collect the ids that published OK.
- `store.delete_outbox_batch(&published_ids)` — one `DELETE … WHERE id = ANY($1)` (new helper).
- Any outbox row whose publish failed (or a crash before delete) is recovered by the existing
  maintenance relay — the exactly-once guarantee relative to the committed state is unchanged.

### 2c. Behavior preservation

- Every instance is still persisted with identical column values; every transition still writes
  an outbox row atomically with the state and is still published then deleted. Only the
  *granularity* changes: the whole rule evaluation now commits in one transaction instead of
  N. This is strictly **more** atomic (all-or-nothing per rule) — an improvement, not a
  regression. `try_claim_eval` already gates re-evaluation, so partial-commit-on-crash is no
  longer possible for a rule.
- Bus publish stays per-event (best-effort, relay-backed). Batching publish is **out of scope**
  — Redis publish is far cheaper than the PG transactions being collapsed.

### 2d. Round-trip impact

Rule with N instances, T transitions: **before** = N + 4T round-trips; **after** = ~4 (one tx)
+ 1 batch delete. A 5,000-instance resolve storm: ~25,000 → ~5 round-trips.

## 3. Phase 2 — Dispatcher: concurrent batch processing

### 3a. Shared `process_event_batch`

Extract the per-batch processing so production and the harness run the *same* code:

```rust
/// Process a consumed batch concurrently, returning the ack decision per entry. Each
/// `process_event` future is independent; `join_all` overlaps their Redis round-trips over
/// the multiplexed connection without spawning (borrowed refs, no 'static needed).
pub async fn process_event_batch(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    groups: &dyn GroupStore,
    cache: &FilterCache,
    cipher: &dyn SecretCipher,
    entries: &[EventEntry],
) -> Vec<(EventId, bool)>
```

Implementation: `futures::future::join_all(entries.iter().map(|e| async { (e.id.clone(),
process_event(store, bus, notifiers, groups, cache, cipher, e).await) }))`. Confirm `futures`
(or `futures-util`) is an available dependency during planning; add it if not.

### 3b. Callers

- `run_dispatcher`: replace the sequential `for entry in entries { process_event; ack }` with
  `let acks = process_event_batch(...).await;` then ack the `true` ones.
- The harness ingest worker (`tests/load_dispatcher.rs`) and `buffer_events` use the same helper,
  so the harness measures the real production path.

### 3c. Correctness

Concurrent `process_event` calls share `&FilterCache` (internal `RwLock`, read-mostly, TTL
cache), the multiplexed Redis `ConnectionManager` (safe for concurrent use), and `&dyn
SecretCipher` (Send+Sync). `add_to_group` is an atomic Lua script and commutative across events
(HSET keyed by fingerprint, ZADD guarded by ZSCORE), so concurrent adds to the same group are
safe. Ack order is irrelevant. Behavior is preserved; only scheduling changes.

## 4. Testing & measurement

- **New IT test** for `persist_eval_batch` (in `crates/stores/tests/`): batch-insert a set of
  instances + events → read back all instances → assert persisted; re-run with changed values →
  assert `ON CONFLICT` updated; assert the returned outbox ids exist; assert empty-input no-op.
- **All existing tests stay green** — both phases are behavior-preserving. Run the evaluator
  unit/IT tests, the dispatcher e2e tests, and `cargo test --workspace`.
- **Harness before/after** per phase, captured as numbers in the PR/notes:
  - Phase 1: `load_evaluator` (expect rules/sec up sharply; also try a transition-heavy variant
    if cheap — e.g. all-absent resolve — to exercise the outbox batch).
  - Phase 2: `load_dispatcher` ingest (expect events/sec up).

## 5. Out of scope (YAGNI)

- Batching `EventBus::publish` across a transition set (best-effort, relay-backed, cheap).
- Pipelining `try_claim_eval` + `get_rule` + `load_instances` into fewer round-trips.
- Connection-pool / Redis-pool tuning.
- Cross-event `add_to_group` coalescing (different groups; low hit rate; the Lua script is
  already optimal per call).

## 6. File map

| File | Change |
|---|---|
| `crates/stores/src/pg.rs` | add `persist_eval_batch`, `delete_outbox_batch`; `PERSIST_BATCH_MAX` |
| `crates/stores/tests/*` | new `persist_eval_batch` IT test |
| `crates/evaluator/src/lib.rs` | rewire `evaluate_rule_against_rows` to collect-then-batch; publish + batch-delete |
| `crates/dispatcher/src/lib.rs` | add `process_event_batch`; use it in `run_dispatcher` |
| `tests/load_dispatcher.rs` | ingest worker + `buffer_events` use `process_event_batch` |
| `Cargo.toml` (root/queue/dispatcher) | add `futures` if not already available |
