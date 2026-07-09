# Performance Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove per-event and per-evaluation allocation and Postgres round-trips from the dispatcher, evaluator, and ClickHouse hot paths, each win proven by a criterion benchmark, with zero behavior change.

**Architecture:** Three independent phases over disjoint crates. Phase 1 (dispatcher+engine-adjacent): cache routes/receivers in the existing `FilterCache` snapshot, return the snapshot behind an `Arc`, and cache compiled regexes. Phase 2 (evaluator+engine): gate the per-rule health round-trip behind an in-memory map and remove redundant label clones in the state-machine path. Phase 3 (clickhouse): stream-parse the JSONEachRow body and drop a redundant format directive. Correctness rests on the existing test suite staying green.

**Tech Stack:** Rust, tokio, sqlx/Postgres, reqwest, serde_json, regex, criterion (new dev-dependency).

**Source spec:** `docs/superpowers/specs/2026-06-15-performance-pass-design.md`

**Global constraints:**
- Behavior-preserving. No new env vars, no migrations, no wire-format changes.
- After every task, the full workspace test suite must compile and pass: `cargo test --workspace`. (Integration tests that need Docker/testcontainers may be skipped locally if Docker is unavailable; they must still compile — `cargo test --workspace --no-run`.)
- Finding 2c (`QuerySig` key) is intentionally **not** implemented — see spec §2c.

---

## File Structure

| File | Responsibility | Phase |
|------|----------------|-------|
| `Cargo.toml` (workspace) | Add `criterion` to `[workspace.dependencies]` | 0 |
| `crates/dispatcher/src/matching.rs` | Compiled-regex cache (1c) | 1 |
| `crates/dispatcher/src/cache.rs` | `Snapshot` gains `routes`/`receivers`; `FilterCache` gains a cipher; `snapshot()` returns `Arc<Snapshot>` (1a, 1b) | 1 |
| `crates/dispatcher/src/lib.rs` | `process_event` reads routes/receivers from the snapshot (1a) | 1 |
| `src/main.rs` + dispatcher/e2e tests | `FilterCache::new` gains a cipher arg (1a) | 1 |
| `crates/dispatcher/Cargo.toml` + `crates/dispatcher/benches/hot_paths.rs` | Dispatcher benches (regex, snapshot) | 1 |
| `crates/engine/src/state_machine.rs` | `evaluate` moves labels instead of cloning (2b) | 2 |
| `crates/evaluator/src/lib.rs` | Move labels into `EvalInput`; in-memory health gate (2a, 2b) | 2 |
| `crates/engine/Cargo.toml` + `crates/engine/benches/eval.rs` | Engine eval bench (2b) | 2 |
| `crates/clickhouse/src/lib.rs` | Extract + stream-parse JSONEachRow; drop redundant format param (3a, 3b) | 3 |
| `crates/clickhouse/Cargo.toml` + `crates/clickhouse/benches/parse.rs` | Parse bench (3a) | 3 |

---

## Phase 0 — Tooling

### Task 1: Add criterion as a workspace dev-dependency

**Files:**
- Modify: `Cargo.toml` (workspace `[workspace.dependencies]`)

- [ ] **Step 1: Add the dependency**

In `Cargo.toml`, add to the `[workspace.dependencies]` table (after `async-trait`):

```toml
criterion = { version = "0.5", features = ["html_reports"] }
```

- [ ] **Step 2: Verify it resolves**

Run: `cargo metadata --format-version 1 >/dev/null`
Expected: exits 0 (the new dependency resolves; nothing uses it yet).

- [ ] **Step 3: Commit**

```bash
git add Cargo.toml
git commit -m "Add criterion as a workspace dev-dependency"
```

---

## Phase 1 — Dispatcher

### Task 2: Compiled-regex cache (1c)

A process-global cache so each distinct regex pattern is compiled once instead of on every `matcher_matches` call (per event × per matcher across routing, silences, inhibition).

**Files:**
- Modify: `crates/dispatcher/src/matching.rs:7-12` (`regex_full_match`)
- Test: `crates/dispatcher/src/matching.rs` (tests module — add one test)

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `crates/dispatcher/src/matching.rs`:

```rust
#[test]
fn repeated_patterns_are_consistent_and_cached() {
    // Same pattern, many calls: behavior identical across calls (cache must not corrupt results).
    for _ in 0..3 {
        assert!(regex_full_match("api-.*", "api-1"));
        assert!(!regex_full_match("api-.*", "web-1"));
        assert!(!regex_full_match("[unterminated", "anything")); // invalid never matches, never cached
    }
    // Distinct patterns coexist in the cache.
    assert!(regex_full_match("a+", "aaa"));
    assert!(regex_full_match("b+", "bbb"));
    assert!(!regex_full_match("a+", "bbb"));
}
```

- [ ] **Step 2: Run it (passes today, guards behavior)**

Run: `cargo test -p cc-dispatcher matching::tests::repeated_patterns_are_consistent_and_cached`
Expected: PASS against the current (uncached) implementation — this test pins behavior so the refactor can't change it.

- [ ] **Step 3: Replace `regex_full_match` with a cached version**

In `crates/dispatcher/src/matching.rs`, replace the imports line and the `regex_full_match` function. Current top of file:

```rust
use cc_domain::routing::{MatchOp, Matcher};
use std::collections::BTreeMap;

/// Anchored (full-string) regex match. An invalid pattern never matches.
pub fn regex_full_match(pattern: &str, val: &str) -> bool {
    match regex::Regex::new(&format!("^(?:{pattern})$")) {
        Ok(re) => re.is_match(val),
        Err(_) => false,
    }
}
```

Replace with:

```rust
use cc_domain::routing::{MatchOp, Matcher};
use std::collections::{BTreeMap, HashMap};
use std::sync::{OnceLock, RwLock};

/// Process-global cache of compiled, anchored patterns, keyed by the raw pattern string.
/// Patterns come from user routes/silences/inhibitions; the distinct count is bounded by
/// configuration size, so the map is intentionally unbounded (see spec §1c).
static REGEX_CACHE: OnceLock<RwLock<HashMap<String, regex::Regex>>> = OnceLock::new();

/// Anchored (full-string) regex match. An invalid pattern never matches and is not cached.
/// Each distinct pattern is compiled at most once.
pub fn regex_full_match(pattern: &str, val: &str) -> bool {
    let cache = REGEX_CACHE.get_or_init(|| RwLock::new(HashMap::new()));
    // Fast path: already compiled.
    if let Ok(guard) = cache.read() {
        if let Some(re) = guard.get(pattern) {
            return re.is_match(val);
        }
    }
    // Slow path: compile once, store, match. Invalid patterns are not cached.
    match regex::Regex::new(&format!("^(?:{pattern})$")) {
        Ok(re) => {
            let matched = re.is_match(val);
            if let Ok(mut guard) = cache.write() {
                guard.insert(pattern.to_string(), re);
            }
            matched
        }
        Err(_) => false,
    }
}
```

- [ ] **Step 4: Run the matching tests**

Run: `cargo test -p cc-dispatcher matching::`
Expected: PASS (all existing matcher tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add crates/dispatcher/src/matching.rs
git commit -m "Cache compiled regexes in the dispatcher matcher engine"
```

---

### Task 3: Cache routes + receivers in the snapshot (1a)

Move the two per-event Postgres queries (`routes_for`, `list_receivers`) and the per-event receiver decryption into `FilterCache::load`, behind the existing 2s TTL. `FilterCache` must gain a cipher to decrypt receivers at load time.

**Files:**
- Modify: `crates/dispatcher/src/cache.rs` (struct fields, `new`/`with_ttl`, `load`)
- Modify: `crates/dispatcher/src/lib.rs:99-200` (`process_event` reads from snapshot)
- Modify: `src/main.rs:156` (`FilterCache::new` call)
- Modify: `crates/dispatcher/tests/dispatch_it.rs:99`, `crates/dispatcher/tests/routing_dispatch_it.rs:122`, `crates/dispatcher/tests/cache_it.rs:38`, `tests/e2e_reconcile_silence.rs:153`, `tests/e2e_routing.rs:143`, `tests/e2e_dispatch.rs:132`, `tests/e2e_silences_inhibition.rs:173`, `tests/e2e_durability.rs:189`, `tests/e2e_grouping.rs:128` (pass cipher to `FilterCache::new`/`with_ttl`)

- [ ] **Step 1: Extend `Snapshot` and give `FilterCache` a cipher**

In `crates/dispatcher/src/cache.rs`, update the imports, the `Snapshot` struct, the `FilterCache` struct, `new`, `with_ttl`, and `load`. Replace the current file body (keep the module doc comment) so it reads:

```rust
use crate::routing::synthetic_labels;
use cc_crypto::SecretCipher;
use cc_domain::ids::{InstanceKey, TenantId};
use cc_domain::inhibition::InhibitionRule;
use cc_domain::receiver::Receiver;
use cc_domain::routing::Route;
use cc_domain::silence::Silence;
use cc_domain::EventStatus;
use cc_stores::{PgStore, StoreError};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// Default per-tenant snapshot lifetime.
pub const DEFAULT_TTL: Duration = Duration::from_secs(2);

/// Immutable per-tenant filter + routing inputs, cloned to callers per event.
#[derive(Clone)]
pub struct Snapshot {
    pub silences: Vec<Silence>,
    pub inhibitions: Vec<InhibitionRule>,
    /// Firing source-set as `(instance_key, synthetic_labels)`.
    pub firing: Vec<(InstanceKey, BTreeMap<String, String>)>,
    /// Routes in evaluation order (priority asc, then creation order).
    pub routes: Vec<Route>,
    /// Receivers with channel secrets already decrypted (see spec §1a security note).
    pub receivers: Vec<Receiver>,
}

struct Entry {
    loaded_at: Instant,
    snap: Arc<Snapshot>,
}

pub struct FilterCache {
    store: PgStore,
    cipher: Arc<dyn SecretCipher>,
    ttl: Duration,
    entries: RwLock<HashMap<String, Entry>>,
}

impl FilterCache {
    pub fn new(store: PgStore, cipher: Arc<dyn SecretCipher>) -> Self {
        Self::with_ttl(store, cipher, DEFAULT_TTL)
    }

    pub fn with_ttl(store: PgStore, cipher: Arc<dyn SecretCipher>, ttl: Duration) -> Self {
        Self {
            store,
            cipher,
            ttl,
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// Return a fresh-enough snapshot for `tenant`, reloading from Postgres if the
    /// cached entry is missing or older than the TTL. A concurrent double-reload is
    /// harmless (idempotent reads; last write wins).
    pub async fn snapshot(&self, tenant: TenantId) -> Result<Arc<Snapshot>, StoreError> {
        {
            let guard = self.entries.read().await;
            if let Some(e) = guard.get(tenant.as_str()) {
                if e.loaded_at.elapsed() <= self.ttl {
                    return Ok(e.snap.clone());
                }
            }
        }
        let key = tenant.as_str().to_string();
        let snap = Arc::new(self.load(tenant).await?);
        let mut guard = self.entries.write().await;
        guard.insert(
            key,
            Entry {
                loaded_at: Instant::now(),
                snap: snap.clone(),
            },
        );
        Ok(snap)
    }

    async fn load(&self, tenant: TenantId) -> Result<Snapshot, StoreError> {
        let now = time::OffsetDateTime::now_utc();
        let silences = self.store.list_active_silences(tenant.clone(), now).await?;
        let inhibitions = self.store.list_inhibitions(tenant.clone()).await?;
        let routes = self.store.routes_for(tenant.clone()).await?;
        let receivers = self
            .store
            .list_receivers(self.cipher.as_ref(), tenant.clone())
            .await?;
        let firing = self
            .store
            .list_firing(tenant)
            .await?
            .into_iter()
            .map(|f| {
                let labels = synthetic_labels(
                    &f.labels,
                    f.severity,
                    EventStatus::Firing,
                    f.rule,
                    cc_domain::EventKind::Alert,
                );
                (f.key, labels)
            })
            .collect();
        Ok(Snapshot {
            silences,
            inhibitions,
            firing,
            routes,
            receivers,
        })
    }
}
```

> Note: this task already changes `snapshot()` to return `Arc<Snapshot>` (the spec's 1b), because adding fields here makes the deep clone strictly worse — folding 1b in avoids touching the file twice. Task 4 is therefore a no-op stub kept only for the bench; see Task 4.

- [ ] **Step 2: Update `process_event` to read routes/receivers from the snapshot**

In `crates/dispatcher/src/lib.rs`, `process_event` currently calls `store.routes_for` and `store.list_receivers`. Replace the routes/receivers loading. The current block (lines ~110-152):

```rust
    let labels = routing::match_labels(ev);
    let snap = match cache.snapshot(ev.tenant.clone()).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, entry_id = %entry.id, tenant = ?ev.tenant,
                "loading filter snapshot failed; leaving event unacked for reclaim");
            return false;
        }
    };
    let now = time::OffsetDateTime::now_utc();
    if silence::is_silenced(&labels, &snap.silences, now) {
        tracing::debug!(entry_id = %entry.id, "event silenced; dropping");
        return true;
    }
    if inhibition::is_inhibited(&labels, &ev.instance_key, &snap.inhibitions, &snap.firing) {
        tracing::debug!(entry_id = %entry.id, "event inhibited; dropping");
        return true;
    }

    let routes = match store.routes_for(ev.tenant.clone()).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, entry_id = %entry.id, tenant = ?ev.tenant,
                "loading routes failed; leaving event unacked in PEL for later reclaim");
            return false;
        }
    };

    if routes.is_empty() {
        return firehose_deliver(store, bus, notifiers, cipher, ev, &entry.id).await;
    }

    let receivers = match store.list_receivers(cipher, ev.tenant.clone()).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, entry_id = %entry.id, tenant = ?ev.tenant,
                "loading receivers failed; leaving event unacked in PEL for later reclaim");
            return false;
        }
    };
    let by_name: HashMap<String, ChannelConfig> =
        receivers.into_iter().map(|r| (r.name, r.channel)).collect();
```

Replace it with (routes/receivers now come from `snap`; the store calls are gone):

```rust
    let labels = routing::match_labels(ev);
    let snap = match cache.snapshot(ev.tenant.clone()).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, entry_id = %entry.id, tenant = ?ev.tenant,
                "loading filter snapshot failed; leaving event unacked for reclaim");
            return false;
        }
    };
    let now = time::OffsetDateTime::now_utc();
    if silence::is_silenced(&labels, &snap.silences, now) {
        tracing::debug!(entry_id = %entry.id, "event silenced; dropping");
        return true;
    }
    if inhibition::is_inhibited(&labels, &ev.instance_key, &snap.inhibitions, &snap.firing) {
        tracing::debug!(entry_id = %entry.id, "event inhibited; dropping");
        return true;
    }

    if snap.routes.is_empty() {
        return firehose_deliver(store, bus, notifiers, cipher, ev, &entry.id).await;
    }

    let by_name: HashMap<&str, &ChannelConfig> = snap
        .receivers
        .iter()
        .map(|r| (r.name.as_str(), &r.channel))
        .collect();
```

Then update the two downstream uses inside the `for target in routing::select_grouping_targets(&routes, &labels)` loop:
- Change the loop header `&routes` → `&snap.routes`.
- The lookup `by_name.get(&target.receiver)` already returns `Option<&&ChannelConfig>` after this change; adjust the bind to deref. Current:

```rust
        let ch = match by_name.get(&target.receiver) {
            Some(c) => c,
            None => { /* warn + continue */ }
        };
```

becomes:

```rust
        let ch = match by_name.get(target.receiver.as_str()) {
            Some(c) => *c,
            None => { /* warn + continue */ }
        };
```

(`ch` is now `&ChannelConfig`, same as before — `ch.target()` / `ch.channel_name()` are unchanged.)

- [ ] **Step 3: Update `FilterCache::new`/`with_ttl` call sites**

Each call site already has a `cipher: Arc<dyn SecretCipher>` in scope. Update:

- `src/main.rs:156`: `let cache = Arc::new(FilterCache::new(store.clone(), cipher.clone()));`
- `crates/dispatcher/tests/dispatch_it.rs:99`: `let cache = Arc::new(FilterCache::new(store.clone(), cipher.clone()));`
- `crates/dispatcher/tests/routing_dispatch_it.rs:122`: `let cache = Arc::new(FilterCache::new(store.clone(), cipher.clone()));`
- `tests/e2e_reconcile_silence.rs:153`, `tests/e2e_routing.rs:143`, `tests/e2e_dispatch.rs:132`, `tests/e2e_silences_inhibition.rs:173`, `tests/e2e_durability.rs:189`, `tests/e2e_grouping.rs:128`: same edit — add `, cipher.clone()` as the second arg (each of these files builds a `cipher` via its local `test_cipher()` before this line; if the variable has a different name in a given file, use that name).

- [ ] **Step 4: Give `cache_it.rs` a cipher**

`crates/dispatcher/tests/cache_it.rs` does not build a cipher today. Add the import and helper, and pass it to `with_ttl`.

Add to imports at the top:

```rust
use cc_crypto::{EnvKeyring, SecretCipher};
use std::collections::HashMap;
use std::sync::Arc;
```

Add a helper above the test fn:

```rust
fn test_cipher() -> Arc<dyn SecretCipher> {
    Arc::new(
        EnvKeyring::new(HashMap::from([("v1".to_string(), [7u8; 32])]), "v1".to_string()).unwrap(),
    )
}
```

Change line 38 from:

```rust
    let cache = FilterCache::with_ttl(store.clone(), Duration::from_millis(150));
```

to:

```rust
    let cache = FilterCache::with_ttl(store.clone(), test_cipher(), Duration::from_millis(150));
```

(The assertions on `s1.silences.len()` etc. are unchanged — field access derefs through the `Arc` transparently.)

- [ ] **Step 5: Build and test**

Run: `cargo build --workspace --tests`
Expected: compiles. Then:
Run: `cargo test -p cc-dispatcher` (and `cargo test --workspace --no-run` to confirm e2e tests compile)
Expected: PASS / compiles. (Docker-backed IT tests may be skipped locally but must compile.)

- [ ] **Step 6: Commit**

```bash
git add crates/dispatcher/src/cache.rs crates/dispatcher/src/lib.rs src/main.rs \
        crates/dispatcher/tests/cache_it.rs crates/dispatcher/tests/dispatch_it.rs \
        crates/dispatcher/tests/routing_dispatch_it.rs tests/e2e_*.rs
git commit -m "Cache routes and receivers in the dispatcher filter snapshot"
```

---

### Task 4: Confirm `Arc<Snapshot>` return (1b)

The `Arc<Snapshot>` change landed in Task 3 (folded in to avoid editing `cache.rs` twice). This task only verifies there is no remaining deep clone and that callers compile against the `Arc` return.

**Files:**
- Verify only: `crates/dispatcher/src/cache.rs`, `crates/dispatcher/src/lib.rs`

- [ ] **Step 1: Verify the return type and that no `snap.clone()` deep-clones remain**

Run: `grep -n "Arc<Snapshot>" crates/dispatcher/src/cache.rs`
Expected: `snapshot()` returns `Result<Arc<Snapshot>, StoreError>`.

Run: `grep -n "\.snap\.clone()\|snap: snap.clone()" crates/dispatcher/src/cache.rs`
Expected: the only `snap.clone()` is the `Arc` clone when inserting the cache entry (refcount bump), not a `Snapshot` deep clone.

- [ ] **Step 2: No commit**

Nothing to change; proceed to Task 5.

---

### Task 5: Dispatcher criterion benchmark (1b, 1c)

**Files:**
- Modify: `crates/dispatcher/Cargo.toml` (dev-dep + `[[bench]]`)
- Create: `crates/dispatcher/benches/hot_paths.rs`

- [ ] **Step 1: Wire the bench target**

In `crates/dispatcher/Cargo.toml`, add to `[dev-dependencies]`:

```toml
criterion.workspace = true
```

and at the end of the file:

```toml
[[bench]]
name = "hot_paths"
harness = false
```

- [ ] **Step 2: Write the benchmark**

Create `crates/dispatcher/benches/hot_paths.rs`:

```rust
use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;

// 1c: cached regex match vs. compiling on every call (the pre-change baseline).
fn bench_regex(c: &mut Criterion) {
    let mut g = c.benchmark_group("regex_full_match");
    g.bench_function("cached", |b| {
        b.iter(|| cc_dispatcher::matching::regex_full_match(black_box("api-.*"), black_box("api-1")))
    });
    g.bench_function("uncached_baseline", |b| {
        b.iter(|| {
            let re = regex::Regex::new("^(?:api-.*)$").unwrap();
            black_box(re.is_match(black_box("api-1")))
        })
    });
    g.finish();
}

criterion_group!(benches, bench_regex);
criterion_main!(benches);
```

(`regex` is already a dependency of `cc-dispatcher`, so the baseline arm resolves. The snapshot-clone-vs-Arc comparison is covered structurally by Task 3 — building a representative `Snapshot` in a bench requires a live store, so the regex comparison is the one self-contained dispatcher micro-bench; the Arc win is argued in the spec.)

- [ ] **Step 3: Build and run the bench briefly**

Run: `cargo bench -p cc-dispatcher --bench hot_paths -- --warm-up-time 1 --measurement-time 2`
Expected: compiles and prints two timings; `cached` is substantially faster than `uncached_baseline`.

- [ ] **Step 4: Commit**

```bash
git add crates/dispatcher/Cargo.toml crates/dispatcher/benches/hot_paths.rs
git commit -m "Add dispatcher regex-cache benchmark"
```

---

## Phase 2 — Evaluator + Engine

### Task 6: Move labels instead of cloning in `evaluate` (2b, engine side)

Remove the per-row `next.labels = input.labels.clone()` by destructuring `EvalInput` and moving `labels` into `next`. The helper functions that previously borrowed `&EvalInput` are changed to take the individual fields they need, so the partial move is clean.

**Files:**
- Modify: `crates/engine/src/state_machine.rs:29-114` (`evaluate`, `maybe_fire`, `make_event`)

- [ ] **Step 1: Confirm the engine tests pass first (they guard the refactor)**

Run: `cargo test -p cc-engine`
Expected: PASS. These tests fully exercise `evaluate`; they must stay green after the change.

- [ ] **Step 2: Rewrite `evaluate`**

Replace `evaluate` (`crates/engine/src/state_machine.rs:29-79`) with:

```rust
/// Pure transition function. Never panics. Deterministic in eval_ts.
pub fn evaluate(prev: InstanceState, input: EvalInput) -> EvalOutcome {
    debug_assert!(input.resolve_after >= 1, "resolve_after must be >= 1");

    let EvalInput {
        present,
        value,
        labels,
        for_duration,
        resolve_after,
        severity,
        annotations,
        eval_ts,
    } = input;

    let mut next = prev.clone();
    next.labels = labels; // moved, not cloned

    if present {
        next.value = value;
        next.last_seen = Some(eval_ts);
        next.absent_count = 0;

        match prev.status {
            Status::Inactive => {
                next.status = Status::Pending;
                next.active_since = Some(eval_ts);
                maybe_fire(next, eval_ts, for_duration, severity, annotations)
            }
            Status::Pending => maybe_fire(next, eval_ts, for_duration, severity, annotations),
            Status::Firing => EvalOutcome { next, event: None },
        }
    } else {
        match prev.status {
            Status::Inactive => EvalOutcome { next, event: None },
            Status::Pending => {
                next.absent_count = prev.absent_count + 1;
                if next.absent_count >= resolve_after {
                    reset_inactive(&mut next);
                }
                EvalOutcome { next, event: None }
            }
            Status::Firing => {
                next.absent_count = prev.absent_count + 1;
                if next.absent_count >= resolve_after {
                    let event = make_event(&next, severity, annotations, eval_ts, EventStatus::Resolved);
                    reset_inactive(&mut next);
                    EvalOutcome {
                        next,
                        event: Some(event),
                    }
                } else {
                    EvalOutcome { next, event: None }
                }
            }
        }
    }
}
```

- [ ] **Step 3: Rewrite `maybe_fire` and `make_event`**

Replace `maybe_fire` (`:81-94`) and `make_event` (`:102-114`) with:

```rust
fn maybe_fire(
    mut next: InstanceState,
    eval_ts: OffsetDateTime,
    for_duration: Duration,
    severity: Severity,
    annotations: &BTreeMap<String, String>,
) -> EvalOutcome {
    let since = next.active_since.expect("active_since set when present");
    let elapsed = eval_ts - since;
    if next.status != Status::Firing && elapsed >= for_duration {
        next.status = Status::Firing;
        let event = make_event(&next, severity, annotations, eval_ts, EventStatus::Firing);
        EvalOutcome {
            next,
            event: Some(event),
        }
    } else {
        EvalOutcome { next, event: None }
    }
}
```

```rust
fn make_event(
    s: &InstanceState,
    severity: Severity,
    annotations: &BTreeMap<String, String>,
    eval_ts: OffsetDateTime,
    status: EventStatus,
) -> Event {
    Event::new(
        s.tenant.clone(),
        s.rule,
        s.key.clone(),
        status,
        s.labels.clone(),
        s.value,
        severity,
        annotations.clone(),
        eval_ts,
    )
}
```

(`Severity`, `Duration`, `OffsetDateTime`, `BTreeMap` are already imported at the top of the file.)

- [ ] **Step 4: Run the engine tests**

Run: `cargo test -p cc-engine`
Expected: PASS (identical behavior; `evaluate`'s signature is unchanged so the evaluator still compiles).

- [ ] **Step 5: Commit**

```bash
git add crates/engine/src/state_machine.rs
git commit -m "Move labels into the next instance state instead of cloning in evaluate"
```

---

### Task 7: Move labels into `EvalInput` in the evaluator (2b, evaluator side)

`present` already owns a per-rule copy of each row's labels (cloned from the shared `rows`). Move that owned copy into `EvalInput` instead of cloning it again, and `mem::take` the absent-path labels out of `prev`.

**Files:**
- Modify: `crates/evaluator/src/lib.rs:199-253` (`evaluate_rule_against_rows`)

- [ ] **Step 1: Rewrite the present-row loop**

In `evaluate_rule_against_rows`, the present-row loop (`:217-233`) currently borrows `&present` and clones labels. Replace the loop:

```rust
    // 1) Evaluate every present row.
    for (key, (labels, value)) in &present {
        let prev = known_keys.remove(key).unwrap_or_else(|| {
            InstanceState::new_inactive(key.clone(), job.rule, job.tenant.clone(), labels.clone())
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
```

with (iterate `present` by value, move `labels`):

```rust
    // 1) Evaluate every present row. `present` is per-rule and consumed here, so each
    // row's labels move into EvalInput instead of being cloned again.
    for (key, (labels, value)) in present {
        let prev = known_keys.remove(&key).unwrap_or_else(|| {
            InstanceState::new_inactive(key.clone(), job.rule, job.tenant.clone(), labels.clone())
        });
        let input = EvalInput {
            present: true,
            value,
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
```

- [ ] **Step 2: Rewrite the absent-path loop**

The absent-path loop (`:236-250`) currently clones `prev.labels`. Replace:

```rust
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
```

with (`mem::take` the labels out of `prev` — `prev`'s labels are overwritten by `next.labels = input.labels` inside `evaluate`, so emptying them first is behavior-preserving):

```rust
    // 2) Evaluate every previously-known instance NOT present now (absence path).
    for (_key, mut prev) in known_keys {
        let labels = std::mem::take(&mut prev.labels);
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
```

- [ ] **Step 3: Build and run the evaluator tests**

Run: `cargo test -p cc-evaluator --no-run` then `cargo test -p cc-evaluator` (the unit tests; the IT tests need Docker).
Expected: compiles; unit tests PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/evaluator/src/lib.rs
git commit -m "Move row labels into EvalInput instead of cloning in the evaluator"
```

---

### Task 8: In-memory health gate (2a)

Avoid the per-rule `record_rule_success` Postgres round-trip on the steady-state healthy path by tracking each rule's last-known degraded state in process memory. The store's conditional UPDATE remains the source of truth; the map only suppresses the redundant round-trip.

**Files:**
- Modify: `crates/evaluator/src/lib.rs` (`run_evaluator`, `process_batch`, add `process_batch_inner`)
- Modify: `crates/evaluator/tests/coalescing_it.rs` (no call-site change needed — see Step 4)

- [ ] **Step 1: Thread a health map without changing `process_batch`'s public signature**

In `crates/evaluator/src/lib.rs`, keep `process_batch` as a thin wrapper (so the 8 test call sites in `coalescing_it.rs` stay unchanged) and move the body into a new `process_batch_inner` that takes a `&mut HashMap<RuleId, bool>` (`true` = last seen degraded).

Add the import near the top (`RuleId` comes from `cc_domain::ids`):

```rust
use cc_domain::ids::{InstanceKey, RuleId};
```

(Adjust the existing `use cc_domain::ids::InstanceKey;` line to the combined form above.)

Replace the `run_evaluator` loop body's `process_batch` call. Current (`:53-74`):

```rust
        let deliveries = match queue.consume(&consumer, 16, 2000).await {
            Ok(d) => d,
            Err(e) => { /* ... */ continue; }
        };
        let to_ack = process_batch(
            &store,
            ch.as_ref(),
            events.as_ref(),
            degrade_after,
            deliveries,
        )
        .await;
```

becomes (declare the map once before the loop, pass it in):

```rust
        let deliveries = match queue.consume(&consumer, 16, 2000).await {
            Ok(d) => d,
            Err(e) => { /* ... unchanged ... */ continue; }
        };
        let to_ack = process_batch_inner(
            &store,
            ch.as_ref(),
            events.as_ref(),
            degrade_after,
            deliveries,
            &mut health,
        )
        .await;
```

Add `let mut health: HashMap<RuleId, bool> = HashMap::new();` immediately before `loop {` in `run_evaluator`.

- [ ] **Step 2: Split `process_batch` into wrapper + inner**

Change the current `pub async fn process_batch(...)` signature/body. Keep the public wrapper:

```rust
/// Public entry point retained for tests and the prior call shape. Uses a fresh,
/// throwaway health map (every rule reconciles once), which is exactly the cold-start
/// behavior — correctness does not depend on the map persisting.
pub async fn process_batch(
    store: &PgStore,
    ch: &dyn RowQuerier,
    events: &dyn EventBus,
    degrade_after: u32,
    deliveries: Vec<Delivery>,
) -> Vec<JobId> {
    let mut health = HashMap::new();
    process_batch_inner(store, ch, events, degrade_after, deliveries, &mut health).await
}
```

Rename the existing implementation to `process_batch_inner` and add the `health` parameter:

```rust
pub async fn process_batch_inner(
    store: &PgStore,
    ch: &dyn RowQuerier,
    events: &dyn EventBus,
    degrade_after: u32,
    deliveries: Vec<Delivery>,
    health: &mut HashMap<RuleId, bool>,
) -> Vec<JobId> {
    // ... existing body, with the two changes below ...
}
```

- [ ] **Step 3: Gate the success/failure paths on the map**

In the query-**failure** arm of `process_batch_inner` (the `Err(e)` branch that loops `for (job, _) in &members`), after a successful `record_rule_failure` that returned `Some`, mark the rule degraded. Current:

```rust
                    match store
                        .record_rule_failure(job.rule, &job.tenant, &msg, degrade_after as i32, now)
                        .await
                    {
                        Ok(Some((ev, id))) => publish_health(store, events, ev, id).await,
                        Ok(None) => {}
                        Err(err) => { /* error log */ }
                    }
```

becomes:

```rust
                    match store
                        .record_rule_failure(job.rule, &job.tenant, &msg, degrade_after as i32, now)
                        .await
                    {
                        Ok(Some((ev, id))) => {
                            health.insert(job.rule, true); // crossed into degraded
                            publish_health(store, events, ev, id).await;
                        }
                        Ok(None) => {}
                        Err(err) => {
                            tracing::error!(rule = ?job.rule, error = %err, "record_rule_failure failed")
                        }
                    }
```

In the query-**success** arm (the `for (job, _) in &members` loop that calls `record_rule_success`), skip the round-trip when the rule is known-healthy. Current:

```rust
        let now = time::OffsetDateTime::now_utc();
        for (job, _) in &members {
            match store.record_rule_success(job.rule, &job.tenant, now).await {
                Ok(Some((ev, id))) => publish_health(store, events, ev, id).await,
                Ok(None) => {}
                Err(err) => { /* error log */ }
            }
        }
```

becomes:

```rust
        let now = time::OffsetDateTime::now_utc();
        for (job, _) in &members {
            // Only reconcile health when the rule might be degraded. `None` (unknown) means
            // "not yet observed this process" → reconcile once. `Some(false)` (known healthy)
            // → skip the round-trip; the store's conditional UPDATE would be a no-op anyway.
            if health.get(&job.rule) == Some(&false) {
                continue;
            }
            match store.record_rule_success(job.rule, &job.tenant, now).await {
                Ok(Some((ev, id))) => {
                    health.insert(job.rule, false); // recovered
                    publish_health(store, events, ev, id).await;
                }
                Ok(None) => {
                    health.insert(job.rule, false); // confirmed healthy; suppress future round-trips
                }
                Err(err) => {
                    tracing::error!(rule = ?job.rule, error = %err, "record_rule_success failed")
                }
            }
        }
```

- [ ] **Step 4: Confirm the coalescing IT tests still compile and pass**

The tests call `process_batch(&store, &ch, &bus, ...)` — unchanged public signature, so no edits. The `repeated_query_errors_degrade_then_recover` test calls `process_batch` multiple times; each call uses a fresh map, which reconciles correctly (degrade writes happen in the failure arm; the recover call hits the success arm with an unknown rule → reconciles).

Run: `cargo test -p cc-evaluator --no-run`
Expected: compiles. (The Docker-backed `coalescing_it` assertions are unchanged in meaning.)

- [ ] **Step 5: Commit**

```bash
git add crates/evaluator/src/lib.rs
git commit -m "Gate per-rule health success writes behind an in-memory degraded map"
```

---

### Task 9: Engine eval benchmark (2b)

**Files:**
- Modify: `crates/engine/Cargo.toml` (dev-dep + `[[bench]]`)
- Create: `crates/engine/benches/eval.rs`

- [ ] **Step 1: Wire the bench target**

In `crates/engine/Cargo.toml`, add to `[dev-dependencies]`:

```toml
criterion.workspace = true
time.workspace = true
```

and at the end:

```toml
[[bench]]
name = "eval"
harness = false
```

- [ ] **Step 2: Write the benchmark**

Create `crates/engine/benches/eval.rs`:

```rust
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::instance::InstanceState;
use cc_domain::rule::Severity;
use cc_engine::{evaluate, EvalInput};
use criterion::{criterion_group, criterion_main, Criterion};
use std::collections::BTreeMap;
use std::hint::black_box;
use time::OffsetDateTime;
use uuid::Uuid;

fn labels(n: usize) -> BTreeMap<String, String> {
    (0..n).map(|i| (format!("k{i}"), format!("v{i}"))).collect()
}

// 2b: a present-row transition over a realistic label set, exercising the label move in evaluate.
fn bench_evaluate(c: &mut Criterion) {
    let tenant = TenantId::from_trusted(Uuid::nil().to_string());
    let rule = RuleId(Uuid::nil());
    let ann = BTreeMap::new();
    let base = InstanceState::new_inactive(InstanceKey("k".into()), rule, tenant, labels(8));

    c.bench_function("evaluate_present_fire", |b| {
        b.iter(|| {
            let input = EvalInput {
                present: true,
                value: Some(1.0),
                labels: labels(8),
                for_duration: time::Duration::seconds(0),
                resolve_after: 1,
                severity: Severity::Warning,
                annotations: &ann,
                eval_ts: OffsetDateTime::UNIX_EPOCH,
            };
            black_box(evaluate(black_box(base.clone()), input))
        })
    });
}

criterion_group!(benches, bench_evaluate);
criterion_main!(benches);
```

(`uuid` is already an engine dev-dependency; `time` is added in Step 1. `EvalInput`/`evaluate` are the crate's public API.)

- [ ] **Step 3: Build and run briefly**

Run: `cargo bench -p cc-engine --bench eval -- --warm-up-time 1 --measurement-time 2`
Expected: compiles and prints a timing.

- [ ] **Step 4: Commit**

```bash
git add crates/engine/Cargo.toml crates/engine/benches/eval.rs
git commit -m "Add engine evaluate benchmark"
```

---

## Phase 3 — ClickHouse

### Task 10: Stream-parse the JSONEachRow body (3a) + drop the redundant format param (3b)

Extract the row-parsing loop into a synchronous, benchmarkable free function that streams values from the buffered body with `serde_json::Deserializer`, and remove the redundant `default_format` query param (keep the appended `FORMAT JSONEachRow`).

**Files:**
- Modify: `crates/clickhouse/src/lib.rs:53-102` (`query_rows`), add `parse_rows` free fn

- [ ] **Step 1: Write a failing test for `parse_rows`**

Add to `crates/clickhouse/src/lib.rs` (a new `#[cfg(test)]` test inside the existing test area, or extend `error_scrub_tests`). Put it in its own module:

```rust
#[cfg(test)]
mod parse_tests {
    use super::*;

    #[test]
    fn parses_jsoneachrow_into_labels_and_value() {
        let body = "{\"svc\":\"api\",\"v\":1.5}\n{\"svc\":\"web\",\"v\":\"2\"}\n\n";
        let rows = parse_rows(body, &["svc".to_string()], Some("v")).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].labels.get("svc").unwrap(), "api");
        assert_eq!(rows[0].value, Some(1.5));
        // string-encoded numbers parse; trailing blank line is ignored.
        assert_eq!(rows[1].value, Some(2.0));
    }

    #[test]
    fn missing_label_column_is_absent_not_error() {
        let body = "{\"other\":\"x\"}";
        let rows = parse_rows(body, &["svc".to_string()], None).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].labels.is_empty());
        assert_eq!(rows[0].value, None);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p cc-clickhouse parse_tests`
Expected: FAIL with "cannot find function `parse_rows`".

- [ ] **Step 3: Add `parse_rows` and call it from `query_rows`**

In `crates/clickhouse/src/lib.rs`, add the free function (near `json_to_string`/`json_to_f64`):

```rust
/// Parse a JSONEachRow body into rows. Streams values from the buffered text with
/// `serde_json::Deserializer`, avoiding an intermediate line split. Produces the same
/// `ResultRow`s as the prior line-by-line parse.
fn parse_rows(
    text: &str,
    label_columns: &[String],
    value_column: Option<&str>,
) -> Result<Vec<ResultRow>, ChError> {
    let mut rows = Vec::new();
    let stream = serde_json::Deserializer::from_str(text)
        .into_iter::<serde_json::Map<String, serde_json::Value>>();
    for obj in stream {
        let obj = obj?;
        let mut labels = BTreeMap::new();
        for col in label_columns {
            if let Some(v) = obj.get(col) {
                labels.insert(col.clone(), json_to_string(v));
            }
        }
        let value = value_column.and_then(|c| obj.get(c)).and_then(json_to_f64);
        rows.push(ResultRow { labels, value });
    }
    Ok(rows)
}
```

Then update `query_rows`: remove the `.query(&[("default_format", "JSONEachRow")])` call (3b) and replace the inline parse loop (3a). The current request build + parse (`:70-101`):

```rust
        let mut req = self
            .http
            .post(&self.base_url)
            .query(&[("default_format", "JSONEachRow")])
            .header("X-ClickHouse-User", &auth.user)
            .header("X-ClickHouse-Key", &auth.key)
            .header("X-ClickHouse-Settings", settings)
            .body(wrapped);
        if let Some(q) = &auth.quota {
            req = req.header("X-ClickHouse-Quota", q);
        }
        let resp = req.send().await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(ChError::Status(status.as_u16(), text));
        }

        let mut rows = Vec::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let obj: serde_json::Map<String, serde_json::Value> = serde_json::from_str(line)?;
            let mut labels = BTreeMap::new();
            for col in label_columns {
                if let Some(v) = obj.get(col) {
                    labels.insert(col.clone(), json_to_string(v));
                }
            }
            let value = value_column.and_then(|c| obj.get(c)).and_then(json_to_f64);
            rows.push(ResultRow { labels, value });
        }
        Ok(rows)
```

becomes:

```rust
        let mut req = self
            .http
            .post(&self.base_url)
            .header("X-ClickHouse-User", &auth.user)
            .header("X-ClickHouse-Key", &auth.key)
            .header("X-ClickHouse-Settings", settings)
            .body(wrapped);
        if let Some(q) = &auth.quota {
            req = req.header("X-ClickHouse-Quota", q);
        }
        let resp = req.send().await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(ChError::Status(status.as_u16(), text));
        }

        parse_rows(&text, label_columns, value_column)
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p cc-clickhouse`
Expected: PASS (the new `parse_tests` + existing `error_scrub_tests`).

- [ ] **Step 5: Commit**

```bash
git add crates/clickhouse/src/lib.rs
git commit -m "Stream-parse ClickHouse JSONEachRow and drop redundant format param"
```

---

### Task 11: ClickHouse parse benchmark (3a)

**Files:**
- Modify: `crates/clickhouse/Cargo.toml` (dev-dep + `[[bench]]`; make `parse_rows` reachable)
- Create: `crates/clickhouse/benches/parse.rs`

- [ ] **Step 1: Expose `parse_rows` to the benchmark**

A criterion bench is a separate crate and can only call public items. Make `parse_rows` public (it has no secrets): change `fn parse_rows` to `pub fn parse_rows` in `crates/clickhouse/src/lib.rs`, and add a doc note `/// Public for benchmarking; not part of the stable API.` above it.

- [ ] **Step 2: Wire the bench target**

In `crates/clickhouse/Cargo.toml`, add to `[dev-dependencies]`:

```toml
criterion.workspace = true
```

and at the end:

```toml
[[bench]]
name = "parse"
harness = false
```

- [ ] **Step 3: Write the benchmark**

Create `crates/clickhouse/benches/parse.rs`:

```rust
use cc_clickhouse::parse_rows;
use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;

fn body(rows: usize) -> String {
    let mut s = String::new();
    for i in 0..rows {
        s.push_str(&format!("{{\"svc\":\"api-{i}\",\"region\":\"eu\",\"v\":{i}}}\n"));
    }
    s
}

fn bench_parse(c: &mut Criterion) {
    let text = body(1000);
    let labels = vec!["svc".to_string(), "region".to_string()];
    c.bench_function("parse_rows_1000", |b| {
        b.iter(|| black_box(parse_rows(black_box(&text), &labels, Some("v")).unwrap()))
    });
}

criterion_group!(benches, bench_parse);
criterion_main!(benches);
```

- [ ] **Step 4: Build and run briefly**

Run: `cargo bench -p cc-clickhouse --bench parse -- --warm-up-time 1 --measurement-time 2`
Expected: compiles and prints a timing for 1000 rows.

- [ ] **Step 5: Commit**

```bash
git add crates/clickhouse/Cargo.toml crates/clickhouse/src/lib.rs crates/clickhouse/benches/parse.rs
git commit -m "Add ClickHouse JSONEachRow parse benchmark"
```

---

## Final verification

### Task 12: Full workspace check

**Files:** none (verification only)

- [ ] **Step 1: Format and lint**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings`
Expected: no diffs from fmt; clippy clean. Fix any lint the new code introduced.

- [ ] **Step 2: Full test compile + unit/integration run**

Run: `cargo test --workspace --no-run` (must compile, including all `tests/e2e_*.rs` and IT crates)
Then: `cargo test --workspace` (Docker-backed IT tests run if Docker is available; otherwise note which were skipped).
Expected: everything compiles; all runnable tests PASS.

- [ ] **Step 3: Sanity-run all benches once**

Run: `cargo bench --workspace -- --warm-up-time 1 --measurement-time 2`
Expected: all three bench crates compile and emit timings.

- [ ] **Step 4: Commit any fmt/clippy fixups**

```bash
git add -A
git commit -m "Format and lint fixups for the performance pass" || echo "nothing to fix up"
```

---

## Self-review notes (coverage vs. spec)

- **1a** routes/receivers cached → Task 3. **1b** `Arc<Snapshot>` → folded into Task 3, verified Task 4. **1c** regex cache → Task 2 (+ bench Task 5).
- **2a** health gate → Task 8. **2b** label clones (engine + evaluator) → Tasks 6 & 7 (+ bench Task 9).
- **2c** → intentionally dropped (spec §2c).
- **3a** streaming parse → Task 10 (+ bench Task 11). **3b** redundant format param → Task 10.
- **#4** batched writes → out of scope (spec).
- Benchmarks: dispatcher (Task 5), engine (Task 9), clickhouse (Task 11) — criterion dev-dep added Task 1. (The evaluator's hot function `evaluate_rule_against_rows` is async + store-bound; its allocation win is benchmarked at the pure-`evaluate` level in the engine bench, per spec.)
- Type/signature consistency: `FilterCache::new(store, cipher)` and `with_ttl(store, cipher, ttl)` used identically at all 9 call sites; `snapshot()` → `Arc<Snapshot>` consumed only by `process_event` (field access) and `cache_it.rs` (field access); `evaluate` signature unchanged; `process_batch` public signature unchanged (wrapper), `process_batch_inner` adds `&mut HashMap<RuleId, bool>`; `parse_rows(&str, &[String], Option<&str>)` used in `query_rows`, tests, and the bench.
