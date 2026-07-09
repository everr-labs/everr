# Clickety-Clack Phase 3B — Durability Hardening (Design Spec)

**Date:** 2026-06-14
**Status:** Approved for planning
**Predecessor:** Phase 3A (silences + inhibition) merged to main (`3b5b6d0`).

## Context

Clickety-clack is a headless Rust alerting system on ClickHouse (Prometheus-class
evaluation + Alertmanager-class dispatch), multi-tenant SaaS. Postgres is the durable
store; Redis Streams is the hot path. Phase 3 was decomposed into four
independently-shippable sub-projects:

- **3A — Silences + Inhibition** — DONE (`3b5b6d0`).
- **3B — Durability hardening** — THIS SPEC.
- **3C — Scale & portability** — scheduler tenant-sharding + Kafka-ready
  `Queue`/`EventBus` + identical-query coalescing. NOT STARTED.
- **3D — Secret encryption-at-rest** — channel-config secrets encrypted in Postgres.
  NOT STARTED.

## Goal

Close two durability gaps in the evaluator → dispatch path **without regressing
hot-path notification latency**, plus housekeeping for expired silences.

## Failure modes being closed

The evaluator today (`crates/evaluator/src/lib.rs`) does, per evaluated instance:

1. `store.upsert_instance(&out.next)` — Postgres write (single statement, autocommit).
2. `events.publish(&ev)` — Redis Streams `XADD` (fire-and-forget; returns `Ok` only if
   the `XADD` itself succeeds).

These are **separate, non-atomic** steps. The code already carries a comment flagging
the gap: "A lost publish means a missed notification for THIS transition (Phase 3 adds
an outbox to make publish atomic with the state write)."

- **Gap 1 — lost publish.** If the publish errors, or the process crashes after the
  Postgres write but before/during the publish, the instance row says `firing` yet no
  firing/resolved event ever reaches the dispatcher. The alert is silently dropped.
- **Gap 2 — stale state / hung alerts.** An instance sits in `pending`/`firing` keyed
  only by `last_seen`. If the evaluator dies, a rule is disabled, or the scheduler stops
  enqueueing jobs for it, that instance never resolves — the alert hangs indefinitely.

## Decisions (locked during brainstorming)

1. **Outbox model = publish-then-relay (not pure transactional outbox).** The evaluator
   commits the instance state change *and* an outbox row in ONE Postgres transaction,
   then publishes to Redis immediately as it does today, and deletes the outbox row on
   success. A lease-singleton **relay** re-publishes any row that outlives a short grace
   window. Rationale: keeps the fast hot path (immediate publish, low latency); the relay
   is pure recovery for failed/crashed publishes. The system is already at-least-once and
   the dispatcher already dedups, so the extra duplicate path costs nothing in practice.
2. **Reconciliation staleness = per-rule interval multiple, auto-resolve firing.**
   Stale = `last_seen` older than `max(4 × rule.interval_secs, 60s)`. A 1s rule and a 1h
   rule go stale proportionally. Action: stale **firing** → emit synthetic Resolved event
   + reset to `Inactive`; stale **pending** → reset to `Inactive` silently (no event ever
   fired).
3. **Expired-silence GC included** as a third sweep in the same maintenance loop.

## Architecture

Two additions, neither on the hot-path critical section:

1. **Transactional event outbox** (new table `event_outbox`) — atomicity primitive for
   `{instance state change + event-to-publish}`.
2. **Maintenance loop** (`run_maintenance`) — one lease-guarded background loop (mirrors
   the scheduler's `RedisLease` singleton pattern) running three sweeps at their own
   cadences: outbox relay (~5s), reconciliation (~5s), silence GC (~hourly).

**Self-cleaning outbox:** rows are **deleted on successful publish**, not marked. The
table only ever holds in-flight/failed rows — tiny, fast partial scans, no separate GC
sweep for the outbox. `created_at` gates the relay's grace window so the relay never
races the inline publish on a freshly-committed row.

## Components

### Migration `0006_event_outbox.sql`

```sql
CREATE TABLE event_outbox (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant     UUID NOT NULL,
    payload    JSONB NOT NULL,           -- serialized cc_domain::Event
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX event_outbox_created ON event_outbox (created_at);
```

### Store methods (`crates/stores/src/pg.rs`)

- `upsert_instance_with_outbox(&self, instance: &InstanceState, ev: &Event) -> Result<Uuid, StoreError>`
  — explicit transaction: `begin` → upsert instance → insert outbox row → `commit` →
  return new row id. The atomicity primitive. No-event instance writes (firing→firing
  no-op, pending counter bumps) keep using the existing `upsert_instance`.
- `claim_outbox(&self, grace: Duration, batch: i64) -> Result<Vec<(Uuid, Event)>, StoreError>`
  — `SELECT id, payload FROM event_outbox WHERE created_at < now() - $grace ORDER BY
  created_at LIMIT $batch FOR UPDATE SKIP LOCKED`. Lease already makes the relay a
  singleton; `SKIP LOCKED` is belt-and-suspenders against lease hand-off races.
- `delete_outbox(&self, id: Uuid) -> Result<(), StoreError>` — `DELETE … WHERE id = $1`.
  Called after a successful publish by both the evaluator (inline) and the relay.
- `list_stale_instances(&self, now: OffsetDateTime) -> Result<Vec<StaleInstance>, StoreError>`
  — JOINs instances→rules: `WHERE i.status IN ('pending','firing') AND i.last_seen <
  now() - make_interval(secs => GREATEST(4 * (r.spec->>'interval_secs')::int, 60))`.
  Returns key, rule, tenant, status, labels, value, and severity (from `r.spec`) —
  everything needed to synthesize a Resolved event, mirroring `list_firing` from 3A.
- `gc_silences(&self, grace: Duration) -> Result<u64, StoreError>` — `DELETE FROM silences
  WHERE ends_at < now() - $grace`; returns deleted count for logging.

`StaleInstance` is a small struct (in `cc-stores` or `cc-domain`) carrying the columns
above.

### Evaluator change (`crates/evaluator/src/lib.rs`)

At the point it currently does `upsert_instance` then `events.publish`, when the state
machine emitted an event:

```rust
let id = store.upsert_instance_with_outbox(&out.next, &ev).await?;  // atomic state+event
match events.publish(&ev).await {
    Ok(()) => { let _ = store.delete_outbox(id).await; }  // best-effort; relay covers a failed delete
    Err(e) => tracing::warn!(?e, "publish failed; relay will recover"),  // row stays → relay republishes
}
```

No-event instances are unchanged (`upsert_instance`). A failed `delete_outbox` is
non-fatal — the relay re-publishes (a duplicate the dispatcher dedups).

### Maintenance loop (new `crates/evaluator/src/maintenance.rs`)

`run_maintenance(store, bus, lease, tick: Duration, shutdown)`. Lives in the evaluator
crate (needs store + bus, both already present; no ClickHouse dependency). Each tick,
**only if it holds the lease**:

- **Relay** (every tick): `claim_outbox(5s, 256)` → for each `(id, ev)`, `bus.publish(&ev)`
  → on success `delete_outbox(id)`; on failure leave for next tick.
- **Reconciliation** (every tick): `list_stale_instances(now)` → for each **firing**,
  synthesize a Resolved `Event` via a shared constructor (extracted so the evaluator's
  resolved emission and the sweep's cannot drift) and write it through
  `upsert_instance_with_outbox(next = Inactive, ev = resolved)`, then publish + delete;
  for each **pending**, plain `upsert_instance` to `Inactive` (no event).
- **Silence GC** (gated ~hourly via an elapsed counter): `gc_silences(24h)`.

### Wiring (`src/main.rs`)

In the `run("evaluator")` block, acquire a `RedisLease` on `cc:maintenance:lease` (same
pattern as `cc:scheduler:lease`, 10s TTL) and spawn `run_maintenance`. Runs on every
evaluator replica; the lease guarantees exactly one active sweeper fleet-wide.

## Failure handling

- **Publish errors** → outbox row committed before the publish attempt; relay republishes
  after grace.
- **Crash between commit and publish/delete** → row durable in Postgres; relay
  republishes.
- **Publish succeeds but inline `delete_outbox` fails/crashes** → relay re-publishes after
  grace → duplicate, absorbed by dispatcher dedup. Deliberate at-least-once trade of the
  publish-then-relay model.
- **Relay publish succeeds but its own delete fails** → re-published next tick, deduped.
- **Lease hand-off race** (two nodes briefly both sweep) → `FOR UPDATE SKIP LOCKED` keeps
  them off the same rows; worst case a few dupes, deduped.

### Reconciliation edge cases

- **Deleted rule** → instances cascade-delete (`ON DELETE CASCADE`); no stale rows from
  deletion; the JOIN excludes them naturally.
- **Evaluator temporarily behind** → an instance genuinely still firing but unevaluated
  for > `4 × interval` is resolved, and the next real eval re-fires it (a resolve→refire
  flap). Mitigated by the 4× multiple + 60s floor. **Documented trade-off:** after 4
  missed evals we genuinely don't know the alert still holds, so resolving is the safer
  default.
- **Synthetic resolved event** is built from the same fields/constructor as the
  evaluator's, so dedup keys and downstream routing/silencing behave identically.

## Testing

- **Unit** — pure staleness predicate `is_stale(interval_secs, last_seen, now) -> bool`
  (boundary cases around the 4×/60s floor); shared Resolved-event constructor.
- **Store ITs** (testcontainers Postgres) — `upsert_instance_with_outbox` writes both rows
  atomically and rolls back together on a forced failure; `claim_outbox` respects the
  grace window (recent row skipped, old row claimed) and `SKIP LOCKED`;
  `list_stale_instances` returns stale firing+pending but not fresh ones and reads
  severity from spec; `gc_silences` deletes only long-expired rows.
- **Relay IT** (Postgres + Redis) — insert an old outbox row → one relay pass → assert
  event on the bus stream and row deleted; fresh row untouched.
- **Reconciliation IT** — seed a stale firing instance → sweep → assert instance
  `Inactive` + Resolved event published; seed stale pending → `Inactive`, no event.
- **e2e** (`tests/e2e_durability.rs`) — wrap the `EventBus` in a publish-failing decorator
  so the inline publish errors; assert the relay subsequently delivers exactly the dropped
  event end-to-end (evaluator → outbox → relay → webhook).

## Backward compatibility

Empty outbox and no-stale-instances are no-ops. Existing evaluator/dispatcher tests are
unaffected; only tests that explicitly exercise `run_maintenance` need the new loop +
`RedisLease` wiring.

## Out of scope (deferred)

- Redis pub/sub cache invalidation for the 3A `FilterCache` and routing/receiver caches
  (separate item).
- Single-flight on cache reload.
- Scheduler tenant-sharding, Kafka-ready queue, query coalescing (Phase 3C).
- Secret encryption-at-rest (Phase 3D).

## Conventions

Rust workspace; TDD bite-sized steps with complete code; Docker-backed testcontainers
Postgres + Redis integration/e2e tests; `cargo clippy --all-targets -- -D warnings`
clean; real gate `cargo test --workspace --no-fail-fast`; package disambiguation
`-p cc@0.1.0`. No Claude/AI attribution anywhere in commits, PRs, or code.
