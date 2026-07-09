# Notify-time Silencing & Batched Instance Writes — Design

**Date:** 2026-06-15
**Status:** Approved (design)

Two independent improvements in disjoint crates, specified together but buildable and
reviewable separately:

- **Feature A — Notify-time silencing** (dispatcher): move the authoritative
  silence/inhibition decision for routed events from ingest to flush, so a silence created
  during the group window actually suppresses already-buffered alerts.
- **Feature B — Batched instance writes** (evaluator + stores + queue): collapse the
  per-instance Postgres round-trip storm in rule evaluation into a bounded set of
  statements per rule, preserving exactly-once.

Both are behavior-preserving except one deliberate semantic change: silences and
inhibitions now apply at flush time, not only at ingest.

---

## Feature A — Notify-time silencing

### Problem

Silencing and inhibition are evaluated exactly once, **at ingest**, in `process_event`
(`crates/dispatcher/src/lib.rs:122-129`) — *before* an event is buffered into its Redis
group (`add_to_group`, `lib.rs:178`). The group flusher (`flush_group`, `lib.rs:278`) later
pulls those events back out — up to `group_wait_secs`/`group_interval_secs` later (default
10s, up to 300s) — and delivers them with **no** silence/inhibition re-check.

Consequence: a silence created during that 10s–300s window does not suppress alerts already
sitting in the group. An operator cannot reliably silence an in-flight alert storm — exactly
when silences are most needed.

The firehose path (no-routes tenants, `firehose_deliver`, `lib.rs:191`) delivers immediately
with no group/flush stage, so for it the at-ingest check is already the delivery-time check.
This feature concerns the **routed/grouped** path only.

### Design

Re-run the filter at flush, against the cached per-tenant snapshot (which already carries
`silences`, `inhibitions`, and the `firing` set — `crates/dispatcher/src/cache.rs:23-32`).

1. **Wire the cache into the flusher.** `run_group_flusher` (`lib.rs:236`) and `flush_group`
   (`lib.rs:278`) gain a `cache: &FilterCache` parameter. The call site in `src/main.rs:178`
   clones the already-constructed `cache` (`src/main.rs:156`) into the flusher task — the
   same `Arc<FilterCache>` the dispatcher loop already uses.

2. **Extract a testable filter helper.** Add a pure function

   ```rust
   /// Drop events suppressed by an active silence or inhibition, evaluated against `snap`.
   /// Returns the surviving events in input order. Firing and resolved are both dropped on
   /// a silence match (behavior-preserving with the at-ingest filter).
   pub fn filter_suppressed(
       snap: &Snapshot,
       events: Vec<Event>,
       now: OffsetDateTime,
   ) -> Vec<Event>
   ```

   For each event it re-derives match labels via `routing::match_labels(ev)` (the group
   stores full `Event`s, so labels are available) and keeps the event unless
   `silence::is_silenced(&labels, &snap.silences, now)` **or**
   `inhibition::is_inhibited(&labels, &ev.instance_key, &snap.inhibitions, &snap.firing)`.

3. **Apply at flush, before the dedup key.** In `flush_group`, after `take_group` returns
   `(meta, events)` and the existing `events.is_empty()` guard (`lib.rs:294`):
   - Load `cache.snapshot(tenant)` (tenant from `meta.tenant`, `lib.rs:301`).
   - `let events = filter_suppressed(&snap, events, now);`
   - If `events` is now empty, return (nothing to deliver — same as the existing empty
     guard). No dedup row is written, no notification sent.
   - Compute `group_dedup_key(gid, channel, target, &events)` (`lib.rs:319`) over the
     **filtered** set, so the key reflects what actually ships and a later re-flush under a
     different silence state yields a different key.

4. **At-ingest check stays unchanged.** It remains the only gate for the firehose path, and
   for the routed path it is a cheap early-drop that avoids buffering obviously-silenced
   events. The flush-time check is the authoritative one for the group window.

### Semantics (settled)

- **Silence drops both firing and resolved** (behavior-preserving with the at-ingest
  filter; matches Alertmanager). Not asymmetric.
- **Both silence and inhibition are re-checked at flush** (the snapshot carries both for
  free). A source alert that began firing during the group window now correctly inhibits the
  buffered targets.
- **Residual gap:** the flush-time decision is still bounded by the snapshot's ~2s TTL, so a
  brand-new silence can take up to ~2s to bite. This shrinks the window from the full group
  interval (up to 300s) to ~2s — a large improvement, not a perfect close.

### Error handling — dead-letter on snapshot-load failure (NOT fail-open)

`take_group` is a destructive claim: its Lua atomically clears the event fields from Redis
and stamps `__last_flush__` (`crates/queue/src/groups.rs:54`, `TAKE_LUA`). So once we are
past `take_group`, the batch exists only in the flusher's memory.

If `cache.snapshot(tenant)` fails at that point, we **dead-letter the claimed batch**,
mirroring the existing decrypt-failure branch in the same function (`lib.rs:302-317`): write
the representative event to `cc:events:deadletter` via `bus.dead_letter`, log, and return.

Rationale:
- **Not fail-open (deliver unfiltered):** the whole point of the feature is that a silence
  must be respected; delivering a batch unfiltered on a transient read error would page the
  operator who silenced it, defeating the feature on the failure path.
- **Not silent-drop:** the dead-letter stream keeps the alerts observable and recoverable
  (the durability doc treats dead-letter backlog as the delivery SLO signal).
- **Not re-buffer/retry:** `take_group` already stamped `__last_flush__`, so re-arming via
  `add_to_group` would schedule the retry at `last_flush + group_interval` (~5 min later,
  `groups.rs:81-87`) — worse than dead-lettering and more code.
- **Rare path:** the snapshot is cached at a 2s TTL and kept warm by the ingest loop, so the
  flush-time read is almost always an in-memory hit. It only reaches Postgres on a cold or
  expired entry; and if Postgres is down the evaluator has already stopped producing events.

### Testing

- Unit tests on `filter_suppressed` (no Redis needed): a silence covering an instance drops
  its buffered firing; a silence drops a buffered resolved too; an inhibition with a matching
  firing source in `snap.firing` drops the target; a non-matching silence/inhibition keeps
  the event; an all-suppressed batch returns empty.
- Dedup-key test: the key computed over the filtered set differs from the key over the
  unfiltered set when at least one event is dropped.
- Existing dispatcher unit + integration tests stay green.

### Out of scope

- Push/pub-sub silence invalidation (the ~2s TTL stays).
- Retro-silencing the firehose path (it has no buffering window to retro-apply to).

---

## Feature B — Batched instance writes

### Problem

`evaluate_rule_against_rows` (`crates/evaluator/src/lib.rs:239`) loops over every present row
and every known-absent instance, calling `publish_transition` (`lib.rs:273, 292`) **once per
instance**. Per instance that is either:

- no-event: one `upsert_instance` round-trip (`pg.rs:545`), or
- event: one `upsert_instance_with_outbox` transaction (`pg.rs:1103`) + an inline
  `events.publish` + a `delete_outbox`.

A rule matching N instances performs ~N sequential Postgres round-trips per evaluation
(plus the `load_instances` read at `lib.rs:252`). For a high-cardinality rule this is the
evaluator's throughput wall — per-instance I/O latency × N, serially. The performance-pass
design (`docs/superpowers/specs/2026-06-15-performance-pass-design.md`, §Scope) explicitly
deferred this because it rewrites the upsert + outbox + publish boundary and the
exactly-once invariant.

### Design

Accumulate all transitions for a rule in memory, then commit and publish them in a bounded
number of operations.

1. **Accumulate (no per-instance I/O).** In `evaluate_rule_against_rows`, run `evaluate(...)`
   for every present and absent instance (already pure) into two vectors:
   - `next_states: Vec<InstanceState>` — every instance's new state.
   - `pending_events: Vec<(Uuid, Event)>` — for transitions that produced an event, a
     pre-generated outbox id paired with the event.

   `load_instances` (`lib.rs:252`) is unchanged — still one read per rule.

2. **One transaction** — new `PgStore::commit_transitions_batch`:

   ```rust
   pub async fn commit_transitions_batch(
       &self,
       states: &[InstanceState],
       outbox: &[(Uuid, Event)],
   ) -> Result<(), StoreError>
   ```

   In a single `tx`:
   - Bulk-UPSERT all `states` via a multi-row `INSERT … ON CONFLICT (key) DO UPDATE`,
     driven by `UNNEST($1::…[], …)` arrays — the same column set and conflict clause as the
     existing `upsert_instance` (`pg.rs:548`).
   - Bulk-INSERT all `outbox` rows via one `INSERT INTO event_outbox (id, tenant, payload)
     SELECT * FROM UNNEST(...)`.
   - `tx.commit()`.

   State and outbox still commit atomically — the exactly-once boundary widens from
   one-instance-one-event to one-rule's-batch but stays atomic. An empty `states` slice is a
   no-op; `outbox` may be empty (a batch with no transitions) — then it is a plain bulk
   upsert.

3. **Pipelined publish** — new `EventBus::publish_batch`:

   ```rust
   /// Publish many events. Returns the indices that were published successfully so the
   /// caller can delete exactly those outbox rows. Backends without a native batch publish
   /// fall back to looping `publish`.
   async fn publish_batch(&self, evs: &[Event]) -> Result<Vec<usize>, QueueError>;
   ```

   - Default trait impl loops `publish`, collecting the indices that succeeded (so any
     `EventBus` works unchanged).
   - The Redis Streams impl (`crates/queue/src/event_bus.rs:51`) issues one pipelined `XADD`
     batch; on a per-entry or pipeline error it returns the prefix/subset that landed.
   - The evaluator calls `publish_batch(&events)` after the transaction commits.

4. **Bulk-delete published outbox rows** — new `delete_outbox_batch(&[Uuid])`: one
   `DELETE FROM event_outbox WHERE id = ANY($1)` for the ids whose events `publish_batch`
   reported as succeeded. Rows for events that did **not** publish are left for the
   maintenance relay, exactly as the single-row path leaves a row on publish failure today
   (`lib.rs:320`).

### Unify on one write primitive (no parallel path)

`commit_transitions_batch` → `publish_batch` → `delete_outbox_batch` becomes the **single**
state+outbox writer in the system. The per-instance `publish_transition` is exactly this
primitive with N=1, so it is collapsed rather than kept alongside:

- A small helper — `commit_and_publish(store, bus, states, outbox)` — wraps the three steps
  (transaction, pipelined publish, delete-published). The per-rule evaluation path calls it
  once with the rule's full transition set.
- `publish_transition` (`evaluator/src/lib.rs:302`) is removed; its single call becomes a
  one-element `commit_and_publish`. Behavior is identical (N=1 batch).
- **Reconciliation is brought onto the same primitive.** `reconcile_once`
  (`crates/evaluator/src/maintenance.rs:55`) currently loops `for s in stale { ... }` doing a
  per-instance `upsert_instance_with_outbox` + inline publish + `delete_outbox` (firing→resolved)
  or a bare `upsert_instance` (silent pending/inactive→inactive reset). It is rewritten to
  accumulate the whole sweep into `states` (every reconciled instance) and `outbox` (only the
  firing→resolved synthetic events) and call `commit_and_publish` **once** — resolving an
  entire stale sweep in one transaction instead of N. The silent resets carry no event, which
  the primitive already handles (an instance in `states` with no matching `outbox` row).

The now-unused single-row `upsert_instance_with_outbox` is removed; `upsert_instance` and the
single `delete_outbox` are retained only if still referenced by non-transition callers
(`upsert_instance` is also used outside this path; the relay keeps `claim_outbox` +
`delete_outbox`). The result: every atomic state+outbox write goes through one code path, so
the equivalence proptest below covers all of them.

**Atomicity caveat (deliberate behavior change).** Batching replaces per-instance error
isolation with all-or-nothing per batch. Today each instance in reconciliation's loop is its
own transaction, so one failing row does not sink the others; under the unified primitive a
single bad row rolls back the whole batch. This is acceptable for both callers because they
are retry-driven — the evaluator re-evaluates the rule next interval, reconciliation re-sweeps
next tick — and a write failure is almost always a DB-level fault that would fail any
transaction. Stated here so the trade-off is explicit, not discovered.

### Commit structure

To keep the safety-critical reconciliation switch independently reviewable, Feature B lands as
**two commits on the feature branch** sharing the one primitive:

1. Add `commit_transitions_batch` / `publish_batch` / `delete_outbox_batch` + `commit_and_publish`;
   switch the per-rule evaluation hot path; remove `publish_transition`.
2. Switch `reconcile_once` onto `commit_and_publish`; remove the now-unused single-row
   `upsert_instance_with_outbox`.

### Exactly-once preservation

- **Atomicity:** state + outbox commit in one transaction (just a wider batch).
- **At-least-once publish stays safe:** a partial or failed `publish_batch` leaves the
  un-published events' outbox rows in place; the maintenance relay (`maintenance.rs`)
  republishes them past the 5s grace window. A relayed re-publish is absorbed by the
  downstream delivery dedup ledger (`notifications` table), unchanged.
- **Idempotent evaluation unchanged:** `try_claim_eval(rule, eval_ts)` is still per-job
  (`lib.rs:132`); a redelivered job is skipped before any of this runs.
- **No crash-window regression:** the prior code could also crash between commit and publish
  for a single event; the relay covered it. Batching only changes how many rows the relay
  may find at once.

### Testing

This touches the safety-critical seam, so:

- **Equivalence proptest:** for a random set of (present rows, known instances), the unified
  path produces the **same** final instance states and the **same** outbox event set as the
  prior per-instance path. Because both the hot path and reconciliation now share the one
  primitive, this single test covers every state+outbox write in the system. Run against the
  in-memory/stub store where possible; the engine `evaluate` is already proptest-covered, so
  this targets the accumulate→commit assembly.
- **Crash-injection unit test:** commit succeeds, `publish_batch` reports zero succeeded →
  all outbox rows survive (relay will recover); commit succeeds, `publish_batch` reports a
  subset → exactly the published ids are deleted, the rest survive.
- **Reconciliation equivalence:** a stale sweep mixing firing→resolved (with events) and
  silent pending/inactive→inactive resets (no event) produces, through `commit_and_publish`,
  the same instance states and the same synthetic resolved events as the prior per-instance
  loop. Covered by the same primitive's tests plus a reconciliation-specific case.
- **Store round-trip tests** (testcontainer Postgres): `commit_transitions_batch` upserts N
  instances and inserts N outbox rows atomically; conflict path updates in place;
  `delete_outbox_batch` deletes only the given ids.
- Existing evaluator unit + integration tests stay green.

### Out of scope

- Batching across *different* rules (the unit stays one rule's transition set — the natural
  boundary of `evaluate_rule_against_rows`). Reconciliation is unified onto the primitive but
  still batches per sweep, not across sweeps.
- Any change to `try_claim_eval` / idempotency-ledger semantics.
- Changing the outbox **relay** (`claim_outbox` + `delete_outbox`); it already operates in
  bulk-claim batches and is not part of this seam.

---

## Phasing & risk

- **Two independent features**, disjoint crates: Feature A is dispatcher-only (+ one line in
  `main.rs`); Feature B is evaluator + stores + queue. They share no code and commit
  separately. Feature B itself lands as two commits (hot-path switch, then reconciliation
  switch) sharing the one primitive, so the safety-net path is reviewable on its own.
- **Correctness bar:** all existing unit and integration tests stay green after each commit,
  plus the new tests above.
- **No config, migration, or wire-format changes.** No new environment variables. The
  `event_outbox` / `instances` schemas are unchanged.
- **Highest-risk surface:** Feature B's `commit_transitions_batch` (the widened atomic
  boundary, now shared by reconciliation) and `publish_batch` partial-failure accounting —
  covered by the equivalence proptest, the reconciliation-equivalence case, and the
  crash-injection test. The deliberate atomicity trade-off (all-or-nothing batch vs
  per-instance isolation) is documented above. Feature A's only behavior change is the
  flush-time suppression, covered by `filter_suppressed` unit tests.

---

## Benchmarks & performance reporting

Each feature must produce **before/after numbers**, captured on the same machine across the
unchanged baseline (the branch point) and the implemented change, and reported in the PR.
The goal: prove Feature B's throughput win and confirm Feature A introduces no meaningful
regression on the flush path.

### What to measure

- **Feature B — evaluator throughput (the headline win).** Use the existing end-to-end load
  harness `tests/load_evaluator.rs` (`load_evaluator_throughput`, `#[ignore]`), which drives
  the real `process_batch_inner` over real Postgres + Redis with the in-process ClickHouse
  stub. This is the measurement that captures the I/O collapse (N round-trips → ~3 per rule);
  the CPU micro-benches deliberately exclude it. Report **evaluations/sec** before vs after,
  at a representative per-rule instance cardinality (e.g. a rule with N≈100–500 instances,
  where the per-instance round-trip storm dominates). Sweep a couple of cardinalities so the
  win is shown to scale with N.

- **Feature A — dispatcher flush path (regression check).** Use `tests/load_dispatcher.rs`
  (`load_dispatcher_throughput`, `#[ignore]`), specifically the flush stage, to confirm the
  added per-flush `cache.snapshot` + `filter_suppressed` does not regress **deliveries/sec**.
  Expectation: negligible, since the snapshot is a warm in-memory hit and the filter is a
  linear pass over a small batch. Report before vs after; flag anything beyond noise.

- **Optional micro-benches (criterion), only if a system number is ambiguous.** A
  `filter_suppressed` bench over a batch with several silences/inhibitions, and a
  `commit_transitions_batch` assembly bench (the in-memory accumulate step) — to localize a
  regression if the load harness shows one. Not required if the harness numbers are clean.

### How to run and report

```
cargo test --release --test load_evaluator  -- --ignored --nocapture
cargo test --release --test load_dispatcher -- --ignored --nocapture
```

Run on the baseline commit and again after the change, same host, same params. The PR
description carries a short table: metric, before, after, delta %, and a one-line read
("evaluator throughput +Nx at 200 instances/rule; dispatcher flush within noise"). A
regression on the Feature A flush path beyond run-to-run noise is a blocker to be explained or
fixed; the Feature B evaluator number is expected to improve materially and the result is
recorded even if modest. These runs are manual (not CI), consistent with the existing
load-harness and criterion conventions.
