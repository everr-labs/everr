# Performance Pass: Hot-Path Allocation & Round-Trip Reduction — Design

**Date:** 2026-06-15
**Status:** Approved (design)

## Goal

Remove per-event and per-evaluation allocation and Postgres round-trips from the three
hot paths — the dispatcher's per-event processing, the evaluator's per-rule loop, and the
ClickHouse query/parse — and prove each win with a criterion benchmark.

Every change is **behavior-preserving**: no semantic change to routing, grouping,
silencing, inhibition, exactly-once delivery, rule health, or the instance state machine.
The acceptance bar for correctness is "all existing unit and integration tests stay green."

## Scope

Ten of the eleven findings from the performance review. **Explicitly out of scope:**
batched per-instance writes (review finding #4) — it rewrites the evaluator's
upsert + outbox + publish boundary and the exactly-once invariant, and is deferred to a
separate effort. Also dropped as YAGNI: the O(n²) `select_receivers` linear scan and
repeated `now_ms()` calls (route counts and call counts are tiny; not worth the churn).

The work is one spec with three independent phases. Each phase compiles, tests, and
commits on its own; phases do not depend on each other and may be reviewed separately.

## Phase 1 — Dispatcher per-event path

The dispatcher's `process_event` (`crates/dispatcher/src/lib.rs`) runs once per event. It
currently performs, per event: a cached snapshot read (silences/inhibitions/firing), **two
uncached Postgres queries** (`routes_for`, `list_receivers`), **N AES decryptions** (one
per receiver channel secret in `list_receivers`), a full clone of the snapshot, and a
regex *compilation* for every regex matcher in every route/silence/inhibition.

### 1a. Fold routes + receivers into the cached `Snapshot`

`FilterCache::load` (`crates/dispatcher/src/cache.rs`) already loads silences, inhibitions,
and firing for a tenant under a 2-second TTL. Extend it to also load `routes`
(`store.routes_for`) and `receivers` (`store.list_receivers`). `Snapshot` gains two fields:

```rust
pub routes: Vec<Route>,
pub receivers: Vec<Receiver>,   // decrypted, as today
```

`process_event` reads `snap.routes` and `snap.receivers` instead of calling the store. The
`by_name: HashMap<String, ChannelConfig>` is built from `snap.receivers`. The firehose
(no-routes) branch is unchanged in behavior — it triggers when `snap.routes.is_empty()`.

**Security tradeoff (accepted, documented):** caching `receivers` caches **decrypted**
channel secrets in process memory for up to the TTL (2s), rather than decrypting them per
event. This does not change the at-rest threat model (DB/backup compromise) that the secret
encryption work addresses: channel secrets are necessarily plaintext in process memory at
send time regardless, and an attacker who can read process memory already wins. The TTL
bounds the exposure window. This is the same posture already applied to silences and
firing data, which the cache holds in cleartext today.

### 1b. Return `Arc<Snapshot>` instead of deep-cloning

`snapshot()` currently returns `e.snap.clone()` — a deep clone of every vector on every
event. With routes and receivers added in 1a the clone grows. Change `Snapshot` storage to
`Arc<Snapshot>` and return a refcount bump:

```rust
pub async fn snapshot(&self, tenant: TenantId) -> Result<Arc<Snapshot>, StoreError>
```

`Entry.snap` becomes `Arc<Snapshot>`; the cache stores and clones the `Arc`. The single
caller (`process_event`) binds `let snap = ...?;` and reads fields through the `Arc`
transparently (no other change). The standalone `FilterCache::load` returns `Snapshot`;
`snapshot()` wraps it in `Arc::new` on miss.

Single-flight on reload (optional, low-risk): a per-tenant load guard so concurrent events
on an expired entry do not all reload from Postgres. If included, it is a `Mutex` keyed by
tenant taken around the load; if it complicates the code it may be omitted (the current
"concurrent double-reload is harmless" property still holds).

### 1c. Compiled-regex cache

`matcher_matches` → `regex_full_match` (`crates/dispatcher/src/matching.rs`) calls
`regex::Regex::new` on **every** invocation. Add a process-global compiled-pattern cache:

```rust
static REGEX_CACHE: OnceLock<RwLock<HashMap<String, Regex>>> = OnceLock::new();
```

`regex_full_match(pattern, val)` looks the anchored pattern up; on miss it compiles once
(anchored as today: `^(?:{pattern})$`), inserts, and matches. An invalid pattern still
never matches (the cache stores only successful compiles; a failed compile returns `false`
without caching). The public signature of `matcher_matches` / `matchers_match` is unchanged,
so routing, silences, and inhibition all benefit from this single change.

The cache is unbounded. Patterns originate from user-defined routes/silences/inhibitions;
in practice the distinct-pattern count is small and bounded by configuration size. A bound
is not added (YAGNI); if it ever matters it is a localized follow-up.

## Phase 2 — Evaluator

### 2a. In-memory health gate

`process_batch` (`crates/evaluator/src/lib.rs`) calls `store.record_rule_success` for every
member of a successful group on every tick. The store call is already conditional (it does
not write when the rule is already healthy), but it still issues a Postgres round-trip per
rule per tick on the steady-state happy path.

`run_evaluator` holds a `HashMap<RuleId, bool>` (`true` = last known degraded). The gate:

- On a query **failure** for a rule: after `record_rule_failure`, if it returned a
  transition event, set the rule's entry to `degraded = true`.
- On a query **success** for a rule: only call `record_rule_success` if the in-memory entry
  says the rule was degraded (or is unknown — unknown means "not yet observed", so call once
  to reconcile). On a returned recovery event, set `degraded = false`.

This removes the per-rule round-trip on the common healthy path while preserving exactly the
same database writes and emitted events. The map is process-local and best-effort: a cold
start (empty map) reconciles by calling `record_rule_success` once per rule, which is the
existing conditional no-op write. Correctness does not depend on the map being durable —
the store's conditional UPDATE remains the source of truth.

`process_batch` gains a `&mut HashMap<RuleId, bool>` parameter (or the map is threaded via a
small struct); `run_evaluator` owns the map across loop iterations.

### 2b. Label clone reduction (three clones → one)

The present-row path currently clones each row's labels three times:

1. `present.insert(key, (row.labels.clone(), row.value))` in `evaluate_rule_against_rows`.
2. `labels.clone()` into `EvalInput.labels`.
3. `next.labels = input.labels.clone()` inside `evaluate` (`crates/engine/src/state_machine.rs`).

Reduce to one allocation per row:

- Consume `rows` / the `present` map by value so labels move into `EvalInput` rather than
  clone (the rows are not used after `present` is built).
- In `evaluate`, move `input.labels` into `next.labels` instead of cloning. `evaluate` takes
  `input` by value but currently borrows `&input` in `maybe_fire` after the clone; reorder so
  the labels are moved out (e.g. take `let labels = input.labels;` / pass needed scalar fields
  before the borrow, or have `maybe_fire` take the fields it needs rather than `&input`). The
  observable result of `evaluate` is unchanged.

`query_rows` still allocates one `BTreeMap` per row at parse time; that allocation is the
single surviving copy and is moved through the pipeline.

### 2c. `QuerySig` key — DROPPED

Originally proposed: avoid cloning `spec.sql` into the coalescing key. Dropped during
planning. An `Arc<str>` field does not save the allocation unless `RuleSpec.sql` is itself
`Arc<str>` (building `Arc<str>` from a `&str` copies the bytes exactly like `String::clone`),
and changing the domain type ripples through serde/stores/API/engine — disproportionate for
the lowest-impact finding (the `QuerySig` is built at most ~16 times per batch and moved into
the HashMap, not cloned). The `u64`-hash alternative is rejected on correctness grounds: a
collision would coalesce two distinct queries and fan the wrong rows to the wrong rule.
`QuerySig` is left unchanged.

## Phase 3 — ClickHouse client

### 3a. Streaming JSON parse

`query_rows` (`crates/clickhouse/src/lib.rs`) buffers the body with `resp.text().await`
(unchanged), then splits on `lines()` and parses each line with `serde_json::from_str` into a
fresh `serde_json::Map`. Replace the line-split + per-line parse with a streaming value
iterator over the buffered text:

```rust
let stream = serde_json::Deserializer::from_str(&text).into_iter::<serde_json::Map<String, serde_json::Value>>();
for obj in stream { let obj = obj?; /* build ResultRow as today */ }
```

This removes the intermediate `lines()` allocation and whitespace filtering while producing
identical `ResultRow`s. Error handling is unchanged: a JSON error maps to `ChError::Json`.
Full streaming of the HTTP body (avoiding the buffered `text`) is a possible follow-up and is
**not** included here — this change stays conservative and within the existing buffered model.

### 3b. Drop the redundant format directive

`query_rows` sets both `?default_format=JSONEachRow` (query param) and appends
`FORMAT JSONEachRow` to the body. These are redundant. **Decision: keep the appended `FORMAT JSONEachRow`** (it travels with
the SQL and is unambiguous) and remove the `default_format` query param. The existing
`error_scrub_tests` and any IT coverage must stay green.

## Benchmarks (criterion)

Add `criterion` as a workspace dev-dependency. Add a `benches/` target to each of the three
crates with a `[[bench]]` entry (`harness = false`) in the crate's `Cargo.toml`:

- **`crates/dispatcher/benches/`**
  - `match_labels` + route selection over a route set containing regex matchers — exercises
    the 1c regex cache (compiled-once vs compiled-per-call).
  - Snapshot access: clone vs `Arc` bump over a snapshot with many silences/firing entries —
    exercises 1b.
- **`crates/evaluator/benches/`**
  - `evaluate_rule_against_rows` over a synthetic N-row `Vec<ResultRow>` with a stub store —
    exercises the 2b label-move. (If a real store is required, benchmark the pure
    `present`-map construction + `EvalInput` assembly in isolation instead.)
- **`crates/clickhouse/benches/`**
  - Parse a synthetic JSONEachRow body of N rows into `Vec<ResultRow>` — exercises 3a. The
    parse loop is factored into a small free function so the benchmark can call it without a
    live ClickHouse.

Benchmarks target the new code and produce reproducible before/after numbers; they are run
manually (`cargo bench`), not in CI. They do not gate correctness — the existing test suite
does. Where a hot function is currently inlined inside an `async fn` (the CH parse loop), it
is extracted into a small synchronous free function so it is independently benchmarkable; the
extraction is behavior-preserving.

## Testing & risk

- **Correctness bar:** all existing unit and integration tests stay green after each phase.
- **Files with semantic surface area:** `crates/dispatcher/src/cache.rs` (return type change
  ripples to `process_event` and the `FilterCache` construction in `src/main.rs`),
  `crates/engine/src/state_machine.rs` (the `evaluate` label move), and
  `crates/evaluator/src/lib.rs` (the health-gate parameter). Everything else is local.
- **Phase independence:** the three phases touch disjoint crates (dispatcher+engine,
  evaluator+engine, clickhouse) and commit separately. The engine `evaluate` change (2b) is
  shared by the evaluator phase only.
- **No config or migration changes.** No new environment variables. No wire-format changes.

## Out of scope (restated)

- Batched per-instance writes / outbox transaction restructuring (review finding #4).
- True HTTP-body streaming from ClickHouse (only the parse is changed, not the buffering).
- A bound on the regex cache.
- O(n²) → map for `select_receivers`; deduplicating `now_ms()` calls.
- `QuerySig` key change (finding 2c) — dropped during planning; see Phase 2 §2c.
