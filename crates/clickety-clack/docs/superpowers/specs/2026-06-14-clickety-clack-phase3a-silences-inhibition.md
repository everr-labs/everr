# Phase 3A — Silences + Inhibition (Design Spec)

**Status:** Approved for planning
**Date:** 2026-06-14
**Predecessor:** Phase 2c (grouping) merged to main (`1bb139a`)
**Parent design:** `docs/superpowers/specs/2026-06-14-clickety-clack-design.md` (Dispatch Pipeline stages 2 "Silence filter" and 3 "Inhibition filter")

## Goal

Add the two correctness filters that run at the very front of the dispatch
pipeline so the effective order becomes:

```
silence → inhibition → routing → grouping → dedup → delivery
```

plus the per-replica TTL cache that feeds them on the hot path.

## Scope decomposition context

Phase 3 was recorded as a grab-bag of eight independent subsystems. It is
decomposed into four independently shippable sub-projects:

- **3A — Silences + Inhibition** (this spec). Dispatch correctness filters + hot-path TTL cache.
- **3B — Durability hardening.** Evaluator publish outbox + stale-`pending` reconciliation sweep.
- **3C — Scale & portability.** Scheduler tenant-sharding + Kafka-ready `Queue`/`EventBus` + identical-query coalescing.
- **3D — Secret encryption-at-rest.** Channel-config secrets encrypted in Postgres.

Each gets its own spec → plan → implement cycle. This spec covers **3A only**.

## Design decisions (locked)

1. **Hot-path access = per-replica TTL cache now; Redis pub/sub invalidation
   deferred.** The per-event code path is identical to the eventual pub/sub
   design (read a per-tenant snapshot), so invalidation only changes *when*
   snapshots refresh and layers on later (it is a separate Phase 3 line item)
   with no rework. TTL = **2 seconds**: near-zero per-event DB load, staleness
   bounded so a new silence takes effect within the TTL.
2. **Silences and inhibition suppress both `firing` and `resolved` events.** If
   an event's labels match an active silence (or an inhibition source), the
   event is dropped regardless of status. "Silenced" means fully silent. A
   silence created mid-incident can suppress the eventual resolved, but the
   firing was already delivered before the silence existed; consumers reconcile
   via the alerts API. (Matches Alertmanager's effective behavior.)

## Domain types (`cc-domain`)

New module `silence.rs`:

```rust
pub struct Silence {
    pub id: Uuid,
    pub tenant: TenantId,
    pub matchers: Vec<Matcher>,
    pub starts_at: OffsetDateTime,
    pub ends_at: OffsetDateTime,
    pub comment: String,
    pub author: String,
    pub created_at: OffsetDateTime,
}
```

A silence is **active** when `starts_at <= now < ends_at`.

New module `inhibition.rs`:

```rust
pub struct InhibitionRule {
    pub id: Uuid,
    pub tenant: TenantId,
    pub source_matchers: Vec<Matcher>,
    pub target_matchers: Vec<Matcher>,
    pub equal: Vec<String>,
    pub created_at: OffsetDateTime,
}
```

Both reuse the existing `Matcher`/`MatchOp` (`eq`/`ne`/`regex`/`notregex`,
anchored full-string regex). Export both from `cc-domain` lib root.

## Storage

### Migration `0005_silences_inhibitions.sql`

```sql
CREATE TABLE silences (
    id          UUID PRIMARY KEY,
    tenant      UUID NOT NULL,
    matchers    JSONB NOT NULL,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    comment     TEXT NOT NULL DEFAULT '',
    author      TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX silences_tenant_ends ON silences (tenant, ends_at);

CREATE TABLE inhibitions (
    id              UUID PRIMARY KEY,
    tenant          UUID NOT NULL,
    source_matchers JSONB NOT NULL,
    target_matchers JSONB NOT NULL,
    equal           JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inhibitions_tenant ON inhibitions (tenant);
```

Additive, nullable-safe migration consistent with `0003`/`0004`.

### Store methods (`cc-stores/pg.rs`)

- `create_silence(tenant, matchers, starts_at, ends_at, comment, author) -> Silence`
- `list_silences(tenant) -> Vec<Silence>` (API list, all silences for tenant)
- `list_active_silences(tenant, now) -> Vec<Silence>` (`starts_at <= now AND ends_at > now`) — dispatch path
- `delete_silence(tenant, id) -> bool`
- `create_inhibition(tenant, source_matchers, target_matchers, equal) -> InhibitionRule`
- `list_inhibitions(tenant) -> Vec<InhibitionRule>`
- `delete_inhibition(tenant, id) -> bool`
- `list_firing(tenant) -> Vec<FiringInstance>` — inhibition source-set. JOINs
  `instances` (`status = 'firing'`) to `rules` and parses `severity` out of the
  rule's `spec` JSONB, because inhibition's primary use case is severity-based
  (critical inhibits warning) and severity is not stored on the instance row.

`FiringInstance` is a new lightweight `cc-domain` type:
`{ key: InstanceKey, rule: RuleId, severity: Severity, labels: BTreeMap }`.

All tenant-filtered. `delete_*` return whether a row was removed (for 404 vs 204).

## Pure filter logic (`cc-dispatcher`)

### Shared matcher engine (`matching.rs`)

Extract the existing private `matcher_matches` and `regex_full_match` from
`routing.rs` into a new `matching.rs`:

```rust
pub fn matchers_match(matchers: &[Matcher], labels: &BTreeMap<String, String>) -> bool;
```

`routing.rs` re-uses it (removes its local copies). Behavior unchanged: empty
matcher list matches everything; anchored regex; invalid pattern never matches.

Also extract synthetic-label construction from `routing::match_labels` into a
reusable `routing::synthetic_labels(labels, severity, status, rule) -> map` (adds
`severity`/`status`/`rule`); `match_labels(ev)` delegates to it. The inhibition
firing-set builds its matchable map via `synthetic_labels(..., status = firing)`
so source/target/`equal` matching runs in the **same** label namespace as the
target event — this is what makes severity-based inhibition work.

### Silence (`silence.rs`)

```rust
pub fn is_silenced(labels: &BTreeMap<String, String>, silences: &[Silence], now: OffsetDateTime) -> bool;
```

True if any **active** silence's matchers all match. (Callers may pre-filter to
active silences via `list_active_silences`; the function re-checks the window
defensively so it is correct against either an active-only or full list.)

### Inhibition (`inhibition.rs`)

```rust
pub fn is_inhibited(
    ev_labels: &BTreeMap<String, String>,   // synthetic_labels(ev): user labels + severity/status/rule
    ev_key: &InstanceKey,
    rules: &[InhibitionRule],
    firing: &[FiringInstance],
) -> bool;
```

The firing-set's matchable map is built once by the caller (the cache) as
`synthetic_labels(f.labels, f.severity, EventStatus::Firing, f.rule)`, so source
and target matchers compare in the same namespace as `ev_labels`.

For each rule:
1. Skip the rule if `ev_labels` matches `source_matchers` (**self-inhibition
   guard** — an alert that is itself a source is never inhibited by that rule).
2. Skip the rule if `ev_labels` does **not** match `target_matchers`.
3. Otherwise, the event is inhibited if some firing instance `f` exists where:
   `f.key != ev_key` **and** `matchers_match(source_matchers, f_labels)` **and**
   for every label name in `equal`, `f_labels.get(l) == ev_labels.get(l)`
   (both present and equal; both absent does **not** count as a match).

Returns true on the first rule that inhibits. To keep `is_inhibited` pure over
label maps, the cache stores firing instances as
`Vec<(InstanceKey, BTreeMap<String,String>)>` (key + pre-synthesized labels);
`is_inhibited` takes `firing: &[(InstanceKey, BTreeMap<String,String>)]`.

## Hot-path cache (`cc-dispatcher/cache.rs`)

```rust
pub struct FilterCache { /* RwLock<HashMap<Uuid, Snapshot>>, store handle, ttl */ }

struct Snapshot {
    loaded_at: Instant,
    silences: Vec<Silence>,       // active silences at load time; window re-checked per event
    inhibitions: Vec<InhibitionRule>,
    firing: Vec<(InstanceKey, BTreeMap<String, String>)>, // key + pre-synthesized labels
}
```

On reload, the cache turns each `FiringInstance` from `list_firing` into
`(key, synthetic_labels(labels, severity, EventStatus::Firing, rule))` so the
inhibition source-set already carries `severity`/`rule`.

- `FilterCache::new(store, ttl)` — TTL = `Duration::from_secs(2)`.
- `async fn snapshot(&self, tenant) -> Snapshot` (cloned): if the cached entry is
  missing or `loaded_at.elapsed() > ttl`, reload all three lists from Postgres
  (`list_active_silences(now)`, `list_inhibitions`, `list_firing`), store, return.
- Concurrency: `RwLock`; a stale entry may be reloaded by two tasks
  concurrently — harmless (idempotent reads, last write wins). Single-flight is
  a possible later optimization, explicitly out of scope.

Uses `std::time::Instant` for elapsed (monotonic). The active-silence window is
loaded with `now` at load time and **re-checked per event** in `is_silenced`, so
a silence expiring within the TTL window stops matching immediately.

## Wiring (`cc-dispatcher/lib.rs`, `process_event`)

Insert at the **top** of `process_event`, before the `routes.is_empty()`
firehose/routed branch, so both delivery paths are filtered identically:

```rust
let labels = routing::match_labels(ev);
let snap = cache.snapshot(ev.tenant).await;
let now = OffsetDateTime::now_utc();
if silence::is_silenced(&labels, &snap.silences, now) {
    tracing::debug!(entry_id = %entry.id, "event silenced; dropping");
    return true; // ack & drop
}
if inhibition::is_inhibited(&labels, &ev.instance_key, &snap.inhibitions, &snap.firing) {
    tracing::debug!(entry_id = %entry.id, "event inhibited; dropping");
    return true; // ack & drop
}
```

`run_dispatcher` gains a `cache: Arc<FilterCache>` parameter, threaded from
`main.rs`. The group flusher does **not** re-filter: events were already
filtered at ingest before buffering (documented trade-off — at-ingest filtering;
an already-buffered event is not retro-silenced).

`labels` is computed once here and reused by the routed path (currently
recomputed inside the routed branch — collapse to the single computation).

## API (`cc-api/src/routes.rs`)

Tenant-scoped via the existing `HeaderAuth` (`X-CC-Tenant: <uuid>`), matching the
existing `/v1/routes` + `/v1/receivers` house style: create returns `200` with the
created body; delete returns `200 {"deleted":true}` or `404` (`ApiError::NotFound`).
New modules `cc-api/src/silences.rs` and `cc-api/src/inhibitions.rs`.

- `POST /v1/silences` — body `{ matchers, starts_at, ends_at, comment, author }` → `200` `Silence`. `422` if `ends_at <= starts_at`.
- `GET /v1/silences` → `200` list.
- `DELETE /v1/silences/:id` → `200 {"deleted":true}` / `404`.
- `POST /v1/inhibitions` — body `{ source_matchers, target_matchers, equal }` → `200` `InhibitionRule`.
- `GET /v1/inhibitions` → `200` list.
- `DELETE /v1/inhibitions/:id` → `200 {"deleted":true}` / `404`.

## main.rs

Dispatcher role builds `Arc<FilterCache>` from the `PgStore` and passes it into
`run_dispatcher`. No new config (TTL is a constant).

## Testing

- **Pure unit (`cc-dispatcher`):**
  - silence: active-window boundaries (`starts_at` inclusive, `ends_at`
    exclusive), each matcher op, empty-matchers-matches-all, no-match passes.
  - inhibition: source firing → inhibited; `equal` label mismatch → not
    inhibited; `equal` label absent on source → not inhibited; self-inhibition
    guard (event matching source matchers is never inhibited); `f.key == ev_key`
    excluded; resolved event with matching source → inhibited (status-agnostic).
  - matching: `matchers_match` parity with prior routing behavior.
- **Store IT (testcontainers Postgres):** silence + inhibition CRUD;
  `list_active_silences` window filter (past/active/future); `list_firing`
  returns only firing instances; `delete_*` return value.
- **Cache unit:** snapshot caches within TTL (no second load); reloads after TTL
  elapses (use a tiny TTL in the test).
- **E2E (testcontainers Postgres + Redis):**
  - Publish a firing event whose labels match an active silence → assert **zero**
    webhook deliveries within the poll window; publish a non-matching control
    event → asserted delivered.
  - Seed a firing source instance + an inhibition rule, publish a matching
    target event → **zero** deliveries; control → delivered.

## Conventions

Rust workspace, TDD bite-sized steps with complete code, Docker-backed
integration tests (testcontainers Postgres + Redis), `cargo clippy --all-targets
-- -D warnings` clean, real gate `cargo test --workspace --no-fail-fast`. No
Claude/Anthropic/AI attribution in commits, PR text, or code comments.

## Out of scope (deferred)

- Redis pub/sub cache invalidation (separate Phase 3 item; TTL cache is the step toward it).
- Retro-filtering events already buffered into a group.
- Silence/inhibition matching against annotations (labels only, as in routing).
- UI / silence expiry GC (expired silences simply stop matching; a GC sweep can come with 3B).
