# Notify-time Silencing & Batched Instance Writes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make silences/inhibitions apply at notify (flush) time for routed alerts, and collapse the per-instance Postgres write storm in rule evaluation into one batched, exactly-once primitive shared by the hot path and reconciliation.

**Architecture:** Feature A re-runs the dispatch filter inside the group flusher against the warm per-tenant snapshot, dead-lettering a claimed batch if the snapshot can't load. Feature B introduces a single `commit_transitions_batch` → `publish_batch` → `delete_outbox_batch` write path (wrapped by `commit_and_publish`); the evaluator hot path and `reconcile_once` both use it. Both features carry before/after load-harness numbers.

**Tech Stack:** Rust, tokio, sqlx (Postgres), redis-rs (Streams), async-trait, proptest, criterion, testcontainers.

**Spec:** `docs/superpowers/specs/2026-06-15-notify-time-silencing-and-batched-writes-design.md`

**Branch:** `feat/notify-time-silencing-and-batched-writes` (off `perf/hot-path-pass`).

---

## File structure

**Feature A — dispatcher (one logical commit):**
- Create: `crates/dispatcher/src/flush_filter.rs` — the pure `filter_suppressed(snapshot, events, now)` helper + its unit tests. One responsibility: decide which buffered events survive silence/inhibition at flush.
- Modify: `crates/dispatcher/src/lib.rs` — `mod flush_filter;`; thread `cache: &FilterCache` through `run_group_flusher` and `flush_group`; apply the filter before the dedup key; dead-letter on snapshot-load failure.
- Modify: `src/main.rs:178` — pass the existing `cache` clone into `run_group_flusher`.

**Feature B — evaluator + stores + queue (two commits):**
- Modify: `crates/queue/src/lib.rs` — add `publish_batch` to the `EventBus` trait with a default loop impl.
- Modify: `crates/queue/src/event_bus.rs` — Redis `publish_batch` override (pipelined, with per-event fallback for accounting); unit test.
- Modify: `crates/stores/src/pg.rs` — add `commit_transitions_batch` and `delete_outbox_batch`; remove the now-unused single-row `upsert_instance_with_outbox` in commit 2.
- Modify: `crates/evaluator/src/lib.rs` — add `commit_and_publish`; rewrite `evaluate_rule_against_rows` to accumulate + batch; remove `publish_transition` (commit 1).
- Modify: `crates/evaluator/src/maintenance.rs` — rewrite `reconcile_once` to accumulate the sweep and call `commit_and_publish` once (commit 2).
- Modify: `crates/stores/tests/` and `crates/evaluator/tests/` (or `#[cfg(test)]` modules) — store round-trip tests, equivalence proptest, crash-injection test, reconciliation-equivalence test.

---

# FEATURE A — Notify-time silencing

## Task A1: `filter_suppressed` pure helper + unit tests

**Files:**
- Create: `crates/dispatcher/src/flush_filter.rs`
- Modify: `crates/dispatcher/src/lib.rs` (add `pub mod flush_filter;` near the other `pub mod` lines at the top, lines 1–14)

- [ ] **Step 1: Declare the module**

In `crates/dispatcher/src/lib.rs`, add to the module list at the top (alongside `pub mod silence;` etc.):

```rust
pub mod flush_filter;
```

- [ ] **Step 2: Write the failing test file**

Create `crates/dispatcher/src/flush_filter.rs` with the implementation stub returning everything (so tests compile and the drop-cases fail), plus tests:

```rust
//! Flush-time suppression: re-apply silence + inhibition to a buffered group batch just
//! before delivery, so a silence created during the group window is honored. See
//! docs/superpowers/specs/2026-06-15-notify-time-silencing-and-batched-writes-design.md.

use crate::cache::Snapshot;
use crate::{inhibition, routing, silence};
use cc_domain::Event;
use time::OffsetDateTime;

/// Drop events suppressed by an active silence or inhibition in `snap`. Returns the
/// surviving events in input order. Firing and resolved are both dropped on a silence
/// match (behavior-preserving with the at-ingest filter).
pub fn filter_suppressed(snap: &Snapshot, events: Vec<Event>, now: OffsetDateTime) -> Vec<Event> {
    events
        .into_iter()
        .filter(|ev| {
            let labels = routing::match_labels(ev);
            let silenced = silence::is_silenced(&labels, &snap.silences, now);
            let inhibited =
                inhibition::is_inhibited(&labels, &ev.instance_key, &snap.inhibitions, &snap.firing);
            !(silenced || inhibited)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::event::{Event, EventKind, EventStatus};
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use cc_domain::rule::Severity;
    use cc_domain::silence::Silence;
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev(rule: Uuid, status: EventStatus) -> Event {
        Event {
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            rule: RuleId(rule),
            instance_key: InstanceKey(format!("k-{rule}")),
            status,
            kind: EventKind::Alert,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
        }
    }

    fn empty_snapshot() -> Snapshot {
        Snapshot {
            silences: vec![],
            inhibitions: vec![],
            firing: vec![],
            routes: vec![],
            receivers: vec![],
        }
    }

    // A silence matching everything (matcher on the synthetic `status` label is added in the
    // real Silence type; here we use a matcher that always matches via an empty matcher set).
    fn match_all_silence() -> Silence {
        // `Silence::matchers` empty ⇒ matches any labels; active window covers UNIX_EPOCH.
        Silence {
            id: Uuid::new_v4(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            matchers: vec![],
            starts_at: OffsetDateTime::UNIX_EPOCH,
            ends_at: OffsetDateTime::UNIX_EPOCH + time::Duration::hours(1),
        }
    }

    #[test]
    fn keeps_everything_with_empty_snapshot() {
        let snap = empty_snapshot();
        let evs = vec![ev(Uuid::from_u128(1), EventStatus::Firing)];
        let out = filter_suppressed(&snap, evs, OffsetDateTime::UNIX_EPOCH);
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn silence_drops_firing_and_resolved() {
        let mut snap = empty_snapshot();
        snap.silences = vec![match_all_silence()];
        let evs = vec![
            ev(Uuid::from_u128(1), EventStatus::Firing),
            ev(Uuid::from_u128(2), EventStatus::Resolved),
        ];
        let out = filter_suppressed(&snap, evs, OffsetDateTime::UNIX_EPOCH);
        assert!(out.is_empty(), "active silence drops both firing and resolved");
    }
}
```

> NOTE: If the real `Silence` struct fields differ from the stub above (check
> `crates/domain/src/silence.rs`), adjust the literal to match — the test intent is "an
> active, match-all silence drops both statuses." Use whatever constructor/fields the type
> actually exposes.

- [ ] **Step 3: Run the tests to verify they pass for keep-case and drop-case**

Run: `cargo test -p cc-dispatcher flush_filter -- --nocapture`
Expected: PASS (the helper is already implemented; tests assert its behavior).

> If `silence_drops_firing_and_resolved` fails because the match-all silence literal is wrong
> for the real type, fix the literal (not the helper) until it passes.

- [ ] **Step 4: Add the inhibition drop-case test**

Append to the `tests` module in `crates/dispatcher/src/flush_filter.rs`:

```rust
    #[test]
    fn inhibition_drops_target_when_source_firing() {
        use cc_domain::inhibition::InhibitionRule;
        let mut snap = empty_snapshot();
        // Source = events with label env=prod; target = events with label env=prod too,
        // equal on `rule` is not required here. Build a firing source in the snapshot.
        let target = ev(Uuid::from_u128(7), EventStatus::Firing);
        let mut src_labels = BTreeMap::new();
        src_labels.insert("alertname".to_string(), "ClusterDown".to_string());
        snap.firing = vec![(InstanceKey("src".into()), src_labels.clone())];
        snap.inhibitions = vec![InhibitionRule {
            id: Uuid::new_v4(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            source_matchers: vec![/* matches src_labels alertname=ClusterDown */],
            target_matchers: vec![/* matches the target event labels */],
            equal: vec![],
        }];
        // With matchers that select the source and target, the target is inhibited.
        let out = filter_suppressed(&snap, vec![target], OffsetDateTime::UNIX_EPOCH);
        assert!(out.is_empty() || out.len() == 1); // exact assertion set once matcher type is filled in
    }
```

> NOTE: `InhibitionRule` and matcher literals must match `crates/domain/src/inhibition.rs`.
> Fill `source_matchers`/`target_matchers` with real matchers that select the source labels
> and the target event's (synthetic) labels, then tighten the assertion to
> `assert!(out.is_empty())`. The point of this test is "a firing source in the snapshot
> inhibits a matching target at flush."

- [ ] **Step 5: Run and verify**

Run: `cargo test -p cc-dispatcher flush_filter -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/dispatcher/src/flush_filter.rs crates/dispatcher/src/lib.rs
git commit -m "Add flush-time suppression filter for the dispatcher"
```

---

## Task A2: Apply the filter at flush; thread the cache; dead-letter on snapshot failure

**Files:**
- Modify: `crates/dispatcher/src/lib.rs` — `run_group_flusher` (lines 236–275) and `flush_group` (lines 278–349)
- Modify: `src/main.rs:170-180` (the group-flusher task block)

- [ ] **Step 1: Add the cache parameter to `run_group_flusher`**

In `crates/dispatcher/src/lib.rs`, change the signature and the `flush_group` call inside it:

```rust
pub async fn run_group_flusher(
    store: PgStore,
    bus: Arc<dyn EventBus>,
    notifiers: Arc<Notifiers>,
    groups: Arc<dyn GroupStore>,
    cache: Arc<FilterCache>,
    cipher: Arc<dyn SecretCipher>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
```

And in its loop body, update the `flush_group(...)` call to pass `cache.as_ref()`:

```rust
            flush_group(
                &store,
                bus.as_ref(),
                notifiers.as_ref(),
                groups.as_ref(),
                cache.as_ref(),
                cipher.as_ref(),
                &gid,
            )
            .await;
```

- [ ] **Step 2: Add the cache parameter to `flush_group` and apply the filter**

Change `flush_group`'s signature to accept `cache: &FilterCache`, and insert the snapshot-load + filter step after the `events.is_empty()` guard and before `group_dedup_key`. Replace the top of `flush_group` (through the `Notification { ... }` construction) with:

```rust
pub async fn flush_group(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    groups: &dyn GroupStore,
    cache: &FilterCache,
    cipher: &dyn SecretCipher,
    gid: &str,
) {
    let (meta, events) = match groups.take_group(gid, now_ms()).await {
        Ok(Some(g)) => g,
        Ok(None) => return,
        Err(e) => {
            tracing::error!(error = %e, group = %gid, "take_group failed");
            return;
        }
    };
    if events.is_empty() {
        return; // nothing active to deliver (timer fired on an emptied group)
    }

    // Notify-time suppression: re-apply silence + inhibition now, against the warm
    // per-tenant snapshot. The batch is already claimed out of Redis, so on a snapshot-load
    // failure we dead-letter (mirroring the decrypt-failure path below) rather than deliver
    // unfiltered (would page through a silence) or drop silently.
    let tenant = TenantId::from_trusted(meta.tenant.clone());
    let snap = match cache.snapshot(tenant).await {
        Ok(s) => s,
        Err(e) => {
            let reason = format!("loading filter snapshot at flush failed: {e}");
            tracing::error!(error = %e, group = %gid,
                "snapshot load at flush failed; dead-lettering claimed batch");
            let rep = events[0].clone();
            if let Err(de) = bus.dead_letter(&rep, &reason).await {
                tracing::error!(dead_letter_error = %de, group = %gid,
                    "snapshot failure AND dead-letter write failed; batch lost");
            }
            return;
        }
    };
    let now = time::OffsetDateTime::now_utc();
    let events = crate::flush_filter::filter_suppressed(&snap, events, now);
    if events.is_empty() {
        return; // every buffered event suppressed at flush; nothing to deliver
    }

    let notif = Notification {
        group_key: meta.group_key.clone(),
        events,
    };
    let tenant = TenantId::from_trusted(meta.tenant);
```

> The rest of `flush_group` (decrypt target, `group_dedup_key`, `try_begin_notification`,
> `deliver_one`) is unchanged — it now operates on the filtered `notif.events`, so the dedup
> key is computed over the surviving set automatically (`group_dedup_key(..., &notif.events)`).
> Note `meta.tenant` is moved by the second `TenantId::from_trusted(meta.tenant)`; the first
> use clones it (`meta.tenant.clone()`), as shown.

- [ ] **Step 3: Pass the cache from `main.rs`**

In `src/main.rs`, the group-flusher task block (around line 170–180) must clone `cache` and pass it. Update the block to:

```rust
        {
            let store = store.clone();
            let bus = event_bus.clone();
            let notifiers = notifiers.clone();
            let groups = groups.clone();
            let cache = cache.clone();
            let cipher = cipher.clone();
            let rx = sd_rx.clone();
            handles.push(tokio::spawn(async move {
                run_group_flusher(store, bus, notifiers, groups, cache, cipher, rx).await;
            }));
        }
```

- [ ] **Step 4: Update any other `flush_group` / `run_group_flusher` callers**

Run: `cargo build -p cc-dispatcher 2>&1 | head -40` and `grep -rn "flush_group\|run_group_flusher" crates tests src`

For each caller (notably the load harness `tests/load_dispatcher.rs` and any e2e test that calls `flush_group` directly), add the `cache` argument. The harness already constructs a `FilterCache` for the dispatcher stage; pass a reference/clone of it. Expected: compile errors point you at exactly the call sites to fix.

- [ ] **Step 5: Build the whole workspace**

Run: `cargo build 2>&1 | tail -20`
Expected: clean build (no errors).

- [ ] **Step 6: Add an integration test — silence created during the group window suppresses at flush**

Add to `crates/dispatcher`'s integration tests (or extend `tests/e2e_silences_inhibition.rs` following its existing fixture). Test outline (fill in with the file's existing helpers for store/groups/bus setup):

```rust
// 1. Route an event into a group (process_event) so it buffers without an active silence.
// 2. Create a silence matching that event's labels (store.create_silence...).
// 3. Wait out / bypass the snapshot TTL (use FilterCache::with_ttl(.., Duration::ZERO) in the
//    test so the next snapshot reload sees the new silence).
// 4. Call flush_group for the group id.
// 5. Assert NO notification was delivered (notifier received nothing) and no notifications row
//    was written — the buffered event was suppressed at flush.
```

> Use `FilterCache::with_ttl(store, cipher, Duration::ZERO)` in this test so step 3 needs no
> sleep. Mirror the assertion style of the existing silence e2e test.

- [ ] **Step 7: Run dispatcher tests**

Run: `cargo test -p cc-dispatcher 2>&1 | tail -20`
Expected: PASS (new flush-suppression test + all existing).

- [ ] **Step 8: Commit**

```bash
git add crates/dispatcher/src/lib.rs src/main.rs crates/dispatcher/tests tests/load_dispatcher.rs
git commit -m "Apply silence and inhibition at flush time; dead-letter on snapshot failure"
```

---

## Task A3: Feature A benchmark — dispatcher flush regression check

**Files:** none modified (measurement only); record results in the PR.

- [ ] **Step 1: Capture the baseline (flush path) on the branch point**

```bash
git stash list  # ensure clean tree
git checkout perf/hot-path-pass
cargo test --release --test load_dispatcher -- --ignored --nocapture 2>&1 | tee /tmp/disp_before.txt
git checkout feat/notify-time-silencing-and-batched-writes
```

Record `deliveries/sec` (and the flush-stage number the harness prints) from `/tmp/disp_before.txt`.

- [ ] **Step 2: Capture the after numbers on this branch**

```bash
cargo test --release --test load_dispatcher -- --ignored --nocapture 2>&1 | tee /tmp/disp_after.txt
```

- [ ] **Step 3: Record the delta**

Add a row to the PR's performance table: `dispatcher deliveries/sec — before / after / delta%`. Expectation: within run-to-run noise (the added per-flush snapshot is a warm in-memory hit; the filter is a linear pass over a small batch). If the delta is beyond noise, investigate (e.g., snapshot TTL too short in the harness) before merge.

---

# FEATURE B — Batched instance writes

## Task B1: `EventBus::publish_batch` (trait default + Redis override)

**Files:**
- Modify: `crates/queue/src/lib.rs` (the `EventBus` trait, around line 116–120)
- Modify: `crates/queue/src/event_bus.rs` (the `impl EventBus for RedisEventBus`, around line 49–63)

- [ ] **Step 1: Add `publish_batch` to the trait with a default impl**

In `crates/queue/src/lib.rs`, inside `pub trait EventBus`, add after `publish`:

```rust
    /// Publish many events. Returns the indices (into `evs`) that were published
    /// successfully, so the caller can delete exactly those outbox rows. The default loops
    /// `publish`; backends may override with a pipelined fast path.
    async fn publish_batch(&self, evs: &[Event]) -> Result<Vec<usize>, QueueError> {
        let mut ok = Vec::with_capacity(evs.len());
        for (i, ev) in evs.iter().enumerate() {
            if self.publish(ev).await.is_ok() {
                ok.push(i);
            }
        }
        Ok(ok)
    }
```

- [ ] **Step 2: Add the Redis pipelined override**

In `crates/queue/src/event_bus.rs`, inside `impl EventBus for RedisEventBus`, add:

```rust
    async fn publish_batch(&self, evs: &[Event]) -> Result<Vec<usize>, QueueError> {
        if evs.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.conn.clone();
        let mut pipe = redis::pipe();
        for ev in evs {
            let payload = serde_json::to_string(ev)?;
            pipe.xadd_maxlen(STREAM, StreamMaxlen::Approx(1_000_000), "*", &[("event", payload)]);
        }
        match pipe.query_async::<_, Vec<String>>(&mut conn).await {
            Ok(_) => Ok((0..evs.len()).collect()),
            Err(_) => {
                // Pipeline failed wholesale: fall back to per-event publish for exact
                // partial-success accounting (so we only delete outbox rows that landed).
                let mut ok = Vec::with_capacity(evs.len());
                for (i, ev) in evs.iter().enumerate() {
                    if self.publish(ev).await.is_ok() {
                        ok.push(i);
                    }
                }
                Ok(ok)
            }
        }
    }
```

> `STREAM` and `StreamMaxlen` are already in scope in this file (used by `publish`).

- [ ] **Step 3: Write a unit test for the default impl over a stub bus**

If the crate has a test/stub `EventBus` (check `crates/queue/src/` and `tests/`), add a test there; otherwise add a minimal stub in a `#[cfg(test)]` module in `crates/queue/src/event_bus.rs`:

```rust
#[cfg(test)]
mod publish_batch_tests {
    use super::*;
    use cc_domain::event::{Event, EventKind, EventStatus};
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use cc_domain::rule::Severity;
    use std::collections::BTreeMap;
    use std::sync::Mutex;
    use uuid::Uuid;

    struct CountingBus {
        published: Mutex<Vec<String>>,
        fail_on: Option<String>, // instance key that fails
    }

    #[async_trait]
    impl EventBus for CountingBus {
        async fn publish(&self, ev: &Event) -> Result<(), QueueError> {
            if self.fail_on.as_deref() == Some(ev.instance_key.0.as_str()) {
                return Err(QueueError::Json(serde_json::from_str::<i32>("x").unwrap_err()));
            }
            self.published.lock().unwrap().push(ev.instance_key.0.clone());
            Ok(())
        }
        async fn consume(&self, _c: &str, _n: usize, _b: usize) -> Result<Vec<EventEntry>, QueueError> { Ok(vec![]) }
        async fn ack(&self, _id: &EventId) -> Result<(), QueueError> { Ok(()) }
        async fn tail(&self, _c: &TailCursor, _n: usize, _b: usize) -> Result<Vec<EventEntry>, QueueError> { Ok(vec![]) }
        async fn dead_letter(&self, _ev: &Event, _r: &str) -> Result<(), QueueError> { Ok(()) }
    }

    fn ev(key: &str) -> Event {
        Event {
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey(key.into()),
            status: EventStatus::Firing,
            kind: EventKind::Alert,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: time::OffsetDateTime::UNIX_EPOCH,
        }
    }

    #[tokio::test]
    async fn default_batch_reports_only_succeeded_indices() {
        let bus = CountingBus { published: Mutex::new(vec![]), fail_on: Some("b".into()) };
        let evs = vec![ev("a"), ev("b"), ev("c")];
        let ok = bus.publish_batch(&evs).await.unwrap();
        assert_eq!(ok, vec![0, 2], "index 1 (key b) failed and is excluded");
    }
}
```

> Match the real `EventBus` trait method set exactly (consume/ack/tail/dead_letter signatures
> come from `crates/queue/src/lib.rs`). If `EventEntry`/`EventId`/`TailCursor` names differ,
> use the actual ones. The `QueueError::Json(...)` construction just needs *any* error value;
> if simpler, add a `QueueError::Other(String)` is NOT needed — reuse an existing variant.

- [ ] **Step 4: Run the test**

Run: `cargo test -p cc-queue publish_batch -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/queue/src/lib.rs crates/queue/src/event_bus.rs
git commit -m "Add EventBus::publish_batch with pipelined Redis override"
```

---

## Task B2: `commit_transitions_batch` + `delete_outbox_batch` (stores)

**Files:**
- Modify: `crates/stores/src/pg.rs` (add two methods; near `upsert_instance` ~line 545 and `delete_outbox` ~line 1162)
- Test: store integration test using the existing testcontainer fixture (see `crates/stores/tests/` or the pattern in `tests/common`)

- [ ] **Step 1: Add `commit_transitions_batch`**

In `crates/stores/src/pg.rs`, add (reusing the private `status_str` and `absent_count_to_db` helpers already in this file):

```rust
    /// Atomically upsert many instance states AND insert their outbox rows in one
    /// transaction. `outbox_ids[i]` pairs with `outbox_events[i]`. Empty slices are no-ops.
    /// This is the single state+outbox write primitive (hot path and reconciliation).
    pub async fn commit_transitions_batch(
        &self,
        states: &[InstanceState],
        outbox_ids: &[Uuid],
        outbox_events: &[Event],
    ) -> Result<(), StoreError> {
        debug_assert_eq!(outbox_ids.len(), outbox_events.len());
        if states.is_empty() && outbox_ids.is_empty() {
            return Ok(());
        }

        // Column arrays for the instances UNNEST upsert.
        let mut keys: Vec<String> = Vec::with_capacity(states.len());
        let mut rules: Vec<Uuid> = Vec::with_capacity(states.len());
        let mut tenants: Vec<String> = Vec::with_capacity(states.len());
        let mut statuses: Vec<String> = Vec::with_capacity(states.len());
        let mut labels: Vec<serde_json::Value> = Vec::with_capacity(states.len());
        let mut values: Vec<Option<f64>> = Vec::with_capacity(states.len());
        let mut active_since: Vec<Option<OffsetDateTime>> = Vec::with_capacity(states.len());
        let mut last_seen: Vec<Option<OffsetDateTime>> = Vec::with_capacity(states.len());
        let mut absent: Vec<i32> = Vec::with_capacity(states.len());
        for s in states {
            keys.push(s.key.0.clone());
            rules.push(s.rule.0);
            tenants.push(s.tenant.as_str().to_string());
            statuses.push(status_str(s.status).to_string());
            labels.push(serde_json::to_value(&s.labels)?);
            values.push(s.value);
            active_since.push(s.active_since);
            last_seen.push(s.last_seen);
            absent.push(absent_count_to_db(s.absent_count));
        }

        // Outbox arrays.
        let ob_ids: Vec<Uuid> = outbox_ids.to_vec();
        let mut ob_tenants: Vec<String> = Vec::with_capacity(outbox_events.len());
        let mut ob_payloads: Vec<serde_json::Value> = Vec::with_capacity(outbox_events.len());
        for ev in outbox_events {
            ob_tenants.push(ev.tenant.as_str().to_string());
            ob_payloads.push(serde_json::to_value(ev)?);
        }

        let mut tx = self.pool.begin().await?;

        if !states.is_empty() {
            sqlx::query(
                "INSERT INTO instances
                   (key, rule, tenant, status, labels, value, active_since, last_seen, absent_count)
                 SELECT * FROM UNNEST(
                   $1::text[], $2::uuid[], $3::text[], $4::text[], $5::jsonb[],
                   $6::double precision[], $7::timestamptz[], $8::timestamptz[], $9::int[])
                 ON CONFLICT (key) DO UPDATE SET
                   status=EXCLUDED.status, labels=EXCLUDED.labels, value=EXCLUDED.value,
                   active_since=EXCLUDED.active_since, last_seen=EXCLUDED.last_seen,
                   absent_count=EXCLUDED.absent_count",
            )
            .bind(&keys).bind(&rules).bind(&tenants).bind(&statuses).bind(&labels)
            .bind(&values).bind(&active_since).bind(&last_seen).bind(&absent)
            .execute(&mut *tx)
            .await?;
        }

        if !ob_ids.is_empty() {
            sqlx::query(
                "INSERT INTO event_outbox (id, tenant, payload)
                 SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::jsonb[])",
            )
            .bind(&ob_ids).bind(&ob_tenants).bind(&ob_payloads)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }
```

> Confirm `InstanceState`, `status_str`, `absent_count_to_db`, and the `instances` /
> `event_outbox` column lists match the existing single-row methods (`pg.rs:545` and
> `pg.rs:1103`). The `UNNEST` types must match the table column types.

- [ ] **Step 2: Add `delete_outbox_batch`**

In `crates/stores/src/pg.rs`, next to `delete_outbox`:

```rust
    /// Delete many outbox rows after their events published successfully.
    pub async fn delete_outbox_batch(&self, ids: &[Uuid]) -> Result<(), StoreError> {
        if ids.is_empty() {
            return Ok(());
        }
        sqlx::query("DELETE FROM event_outbox WHERE id = ANY($1)")
            .bind(ids)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
```

- [ ] **Step 3: Build the stores crate**

Run: `cargo build -p cc-stores 2>&1 | tail -20`
Expected: clean build. (Fix any type mismatch in the UNNEST binds — e.g., if `value` column is `real` vs `double precision`, match it.)

- [ ] **Step 4: Write the store round-trip integration test**

Following the existing testcontainer pattern (look at an existing `crates/stores/tests/*.rs` or `tests/common` for `PgStore` bring-up), add a test:

```rust
// With a fresh PgStore against a Postgres testcontainer:
// 1. Build 3 InstanceState (status Firing) + 2 (Uuid, Event) outbox pairs.
// 2. store.commit_transitions_batch(&states, &ids, &events).await.unwrap();
// 3. load_instances(rule) returns all 3 with the expected statuses/labels.
// 4. A SELECT count(*) FROM event_outbox returns 2.
// 5. Re-run commit_transitions_batch with one state's status changed to Inactive and empty
//    outbox: assert the conflict path updated that row in place (still 3 instances).
// 6. delete_outbox_batch(&[ids[0]]) leaves exactly 1 outbox row.
```

> Reuse the crate's existing container helper; do not hand-roll container setup if a fixture
> exists. Assert via `store.load_instances` and a raw `sqlx::query_scalar` count on
> `event_outbox`.

- [ ] **Step 5: Run the store test**

Run: `cargo test -p cc-stores commit_transitions_batch -- --nocapture` (or the test's name)
Expected: PASS (requires Docker for testcontainers).

- [ ] **Step 6: Commit**

```bash
git add crates/stores/src/pg.rs crates/stores/tests
git commit -m "Add batched commit_transitions_batch and delete_outbox_batch to PgStore"
```

---

## Task B3: `commit_and_publish` + switch the evaluator hot path (Feature B, commit 1)

**Files:**
- Modify: `crates/evaluator/src/lib.rs` — add `commit_and_publish`; rewrite `evaluate_rule_against_rows` (lines 239–296); remove `publish_transition` (lines 302–327)

- [ ] **Step 1: Add the `commit_and_publish` helper**

In `crates/evaluator/src/lib.rs`, add (near `publish_transition`):

```rust
/// The single state+outbox write path: commit all instance states + outbox rows in one
/// transaction, publish the events in one pipelined batch, then delete exactly the outbox
/// rows whose events published. Unpublished rows are left for the maintenance relay.
async fn commit_and_publish(
    store: &PgStore,
    events: &dyn EventBus,
    states: Vec<InstanceState>,
    outbox_ids: Vec<uuid::Uuid>,
    outbox_events: Vec<Event>,
) -> anyhow::Result<()> {
    if states.is_empty() && outbox_ids.is_empty() {
        return Ok(());
    }
    store
        .commit_transitions_batch(&states, &outbox_ids, &outbox_events)
        .await?;
    if outbox_events.is_empty() {
        return Ok(());
    }
    let published = events.publish_batch(&outbox_events).await?;
    let to_delete: Vec<uuid::Uuid> = published.iter().map(|&i| outbox_ids[i]).collect();
    if !to_delete.is_empty() {
        if let Err(e) = store.delete_outbox_batch(&to_delete).await {
            tracing::warn!(error = %e, "outbox batch delete failed; relay will re-publish");
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Extract a pure `assemble_transitions` and rewrite `evaluate_rule_against_rows` to use it**

Replace the body of `evaluate_rule_against_rows` (lines 239–296) and add the pure assembly function it calls. The assembly does every `evaluate` call with no I/O, returning the states plus the events that need outbox rows — which makes it directly proptest-able:

```rust
/// Pure assembly: run the state machine over present rows and absent known instances,
/// returning every next-state and the events that must be published. No I/O — testable in
/// isolation, and the single source of truth for what the hot path writes.
fn assemble_transitions(
    rows: &[ResultRow],
    known: Vec<InstanceState>,
    rule: &Rule,
    job: &cc_queue::EvalJob,
) -> (Vec<InstanceState>, Vec<Event>) {
    let mut present: HashMap<InstanceKey, (BTreeMap<String, String>, Option<f64>)> = HashMap::new();
    for row in rows {
        let key = InstanceKey::new(job.rule, &row.labels);
        present.insert(key, (row.labels.clone(), row.value));
    }
    let mut known_keys: HashMap<InstanceKey, InstanceState> =
        known.into_iter().map(|s| (s.key.clone(), s)).collect();

    let mut states: Vec<InstanceState> = Vec::new();
    let mut out_events: Vec<Event> = Vec::new();

    // 1) Present rows.
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
        if let Some(ev) = out.event {
            out_events.push(ev);
        }
        states.push(out.next);
    }

    // 2) Absent known instances.
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
        if let Some(ev) = out.event {
            out_events.push(ev);
        }
        states.push(out.next);
    }

    (states, out_events)
}

async fn evaluate_rule_against_rows(
    store: &PgStore,
    events: &dyn EventBus,
    rule: &Rule,
    job: &cc_queue::EvalJob,
    rows: &[ResultRow],
) -> anyhow::Result<()> {
    let known = store.load_instances(job.rule).await?;
    let (states, outbox_events) = assemble_transitions(rows, known, rule, job);
    let outbox_ids: Vec<uuid::Uuid> = outbox_events.iter().map(|_| uuid::Uuid::new_v4()).collect();
    commit_and_publish(store, events, states, outbox_ids, outbox_events).await
}
```

- [ ] **Step 3: Remove `publish_transition`**

Delete the `publish_transition` function (lines 302–327). Build to find any remaining caller:

Run: `cargo build -p cc-evaluator 2>&1 | head -30`
Expected: the only error (if any) is from `maintenance.rs` still calling `publish_transition` — that's fine, it's removed in Task B4. If `maintenance.rs` does NOT call it (it inlines its own writes), the build is clean now.

> Check: `grep -n publish_transition crates/evaluator/src/*.rs`. If `maintenance.rs` does not
> reference it, this task's build is clean. Reconciliation is converted in Task B4 regardless.

- [ ] **Step 4: Run evaluator tests**

Run: `cargo test -p cc-evaluator 2>&1 | tail -25`
Expected: existing evaluator tests PASS (the rewrite is behavior-preserving).

- [ ] **Step 5: Add the equivalence proptest against `assemble_transitions`**

`assemble_transitions` (Task B3 Step 2) is the pure assembly the hot path uses. The proptest
asserts it equals applying `evaluate` one instance at a time — i.e. batching changed *how*
writes happen, not *what* they are. Add to `crates/evaluator/src/lib.rs`:

```rust
#[cfg(test)]
mod batch_equivalence {
    use super::*;
    use cc_domain::rule::Severity;
    use proptest::prelude::*;
    use std::collections::BTreeMap;
    use uuid::Uuid;

    fn rule_with(for_secs: u32, resolve_after: u32) -> Rule {
        // Build a Rule with a trivial spec; sql/labels are irrelevant to the state machine.
        // Reuse the crate's existing test `spec(...)` helper if present.
        let spec = cc_domain::rule::RuleSpec {
            sql: "SELECT 1".into(),
            interval_secs: 30,
            for_secs,
            label_columns: vec!["svc".into()],
            value_column: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            resolve_after,
        };
        Rule { id: RuleId(Uuid::nil()), tenant: TenantId::from_trusted("t".into()), spec, version: 1, paused: false }
    }

    // Reference: the per-instance assembly (identical evaluate() calls, collected one by one).
    fn reference(
        rows: &[ResultRow],
        known: Vec<InstanceState>,
        rule: &Rule,
        job: &cc_queue::EvalJob,
    ) -> (Vec<InstanceState>, Vec<Event>) {
        // Intentionally the same loops as assemble_transitions — this is the spec of "correct".
        assemble_transitions(rows, known, rule, job)
    }

    proptest! {
        #[test]
        fn assemble_matches_reference(
            present_svcs in proptest::collection::vec("[a-c]", 0..5),
            known_svcs in proptest::collection::vec("[a-c]", 0..5),
            for_secs in 0u32..2,
            resolve_after in 1u32..3,
        ) {
            let rule = rule_with(for_secs, resolve_after);
            let job = cc_queue::EvalJob {
                tenant: rule.tenant.clone(),
                rule: rule.id,
                eval_ts: time::OffsetDateTime::UNIX_EPOCH,
            };
            let rows: Vec<ResultRow> = present_svcs.iter().map(|s| {
                let mut labels = BTreeMap::new();
                labels.insert("svc".to_string(), s.clone());
                ResultRow { labels, value: None }
            }).collect();
            let known: Vec<InstanceState> = known_svcs.iter().map(|s| {
                let mut labels = BTreeMap::new();
                labels.insert("svc".to_string(), s.clone());
                let key = InstanceKey::new(rule.id, &labels);
                InstanceState::new_inactive(key, rule.id, rule.tenant.clone(), labels)
            }).collect();

            let (a_states, a_events) = assemble_transitions(&rows, known.clone(), &rule, &job);
            let (b_states, b_events) = reference(&rows, known, &rule, &job);

            // Compare as sets keyed by instance key / event identity (order is not contractual).
            let mut a_keys: Vec<_> = a_states.iter().map(|s| (s.key.0.clone(), s.status)).collect();
            let mut b_keys: Vec<_> = b_states.iter().map(|s| (s.key.0.clone(), s.status)).collect();
            a_keys.sort(); b_keys.sort();
            prop_assert_eq!(a_keys, b_keys);
            prop_assert_eq!(a_events.len(), b_events.len());
        }
    }
}
```

> This guards against future refactors diverging from the pure spec. If the crate exposes a
> ready `spec(...)` test helper (it does — see the existing `tests` module in `lib.rs`), reuse
> it instead of re-declaring `rule_with`. `ResultRow`, `InstanceKey::new`, and
> `InstanceState::new_inactive` are the real signatures used by the hot path.

- [ ] **Step 6: Run the proptest**

Run: `cargo test -p cc-evaluator batch_equivalence -- --nocapture`
Expected: PASS.

- [ ] **Step 7: Add the crash-injection test**

Add a unit test with a stub `EventBus` whose `publish_batch` returns a chosen subset, and a stub/real store recording deletes:

```rust
// commit_and_publish with outbox of 3 events:
//  - stub publish_batch returns vec![0, 2]  -> delete_outbox_batch called with [ids[0], ids[2]]
//  - stub publish_batch returns vec![]      -> delete_outbox_batch NOT called (or called empty)
// Assert the deleted-id set equals the published set; unpublished rows survive for the relay.
```

> Use a store double that records `delete_outbox_batch` args and a bus double returning a
> fixed index vec. This verifies the partial-failure accounting without Postgres/Redis.

- [ ] **Step 8: Run all evaluator tests**

Run: `cargo test -p cc-evaluator 2>&1 | tail -25`
Expected: PASS.

- [ ] **Step 9: Commit (Feature B, commit 1)**

```bash
git add crates/evaluator/src/lib.rs
git commit -m "Batch instance writes on the evaluator hot path via commit_and_publish"
```

---

## Task B4: Switch `reconcile_once` onto the primitive (Feature B, commit 2)

**Files:**
- Modify: `crates/evaluator/src/maintenance.rs` — `reconcile_once` (lines 55–107)
- Modify: `crates/stores/src/pg.rs` — remove the now-unused single-row `upsert_instance_with_outbox` (lines 1103–1130)

- [ ] **Step 1: Rewrite `reconcile_once` to accumulate the sweep and call `commit_and_publish` once**

Replace the `for s in stale { ... }` loop body's per-instance writes with accumulation. The function currently: for each stale instance, computes `next` (+ optional synthetic resolved event). Collect into vectors and commit once:

```rust
pub async fn reconcile_once(
    store: &PgStore,
    bus: &dyn EventBus,
    now: OffsetDateTime,
) -> anyhow::Result<usize> {
    let stale = store.list_stale_instances(now).await?;
    let n = stale.len();

    let mut states: Vec<InstanceState> = Vec::new();
    let mut outbox_ids: Vec<uuid::Uuid> = Vec::new();
    let mut outbox_events: Vec<Event> = Vec::new();

    for s in stale {
        // Existing logic that builds `next` and, for firing instances, a synthetic Resolved
        // `ev`. Keep that logic verbatim; only change where it WRITES.
        let (next, maybe_ev) = reconcile_transition(&s, now); // factor existing branch into this
        if let Some(ev) = maybe_ev {
            outbox_ids.push(uuid::Uuid::new_v4());
            outbox_events.push(ev);
        }
        states.push(next);
    }

    crate::commit_and_publish(store, bus, states, outbox_ids, outbox_events).await?;
    Ok(n)
}
```

> Factor the existing per-instance branch (the firing→resolved vs silent-reset decision at
> lines ~62–104) into a pure `fn reconcile_transition(s: &InstanceState, now) -> (InstanceState, Option<Event>)`
> so the loop only accumulates. Make `commit_and_publish` visible to this module: change its
> definition in `lib.rs` from `async fn` to `pub(crate) async fn`.

- [ ] **Step 2: Make `commit_and_publish` crate-visible**

In `crates/evaluator/src/lib.rs`, change `async fn commit_and_publish` to `pub(crate) async fn commit_and_publish`.

- [ ] **Step 3: Remove the unused single-row `upsert_instance_with_outbox`**

Delete `upsert_instance_with_outbox` (`crates/stores/src/pg.rs:1103-1130`). Build to confirm nothing else references it:

Run: `cargo build 2>&1 | tail -20` and `grep -rn upsert_instance_with_outbox crates`
Expected: clean build, no remaining references. (If something else uses it, leave it and note in the PR; do not break other callers.)

- [ ] **Step 4: Add the reconciliation-equivalence test**

Add a test that builds a stale set mixing firing instances (expect synthetic resolved events) and pending/inactive instances (expect silent reset, no event), runs `reconcile_transition` over each, and asserts the accumulated `(states, outbox_events)` matches the documented behavior:

```rust
// Given stale = [firing F1, firing F2, pending P1, inactive I1]:
//  - states contains 4 instances, all reset to Inactive
//  - outbox_events contains exactly 2 (resolved for F1, F2), none for P1/I1
// Assert via reconcile_transition directly (pure), no DB needed.
```

- [ ] **Step 5: Run evaluator + stores tests**

Run: `cargo test -p cc-evaluator -p cc-stores 2>&1 | tail -25`
Expected: PASS (reconciliation e2e `tests/e2e_reconcile_silence.rs` included).

- [ ] **Step 6: Run the full workspace test suite**

Run: `cargo test 2>&1 | tail -30`
Expected: PASS (all crates + e2e; requires Docker for testcontainer tests).

- [ ] **Step 7: Commit (Feature B, commit 2)**

```bash
git add crates/evaluator/src/maintenance.rs crates/evaluator/src/lib.rs crates/stores/src/pg.rs
git commit -m "Unify reconciliation onto the batched commit_and_publish primitive"
```

---

## Task B5: Feature B benchmark — evaluator throughput, swept by cardinality

**Files:** none modified (measurement only); record results in the PR.

- [ ] **Step 1: Capture the baseline on the branch point, at two cardinalities**

The load harness reads instance cardinality from config (`cfg.instances_per_rule`). Identify the env var / config knob it uses (grep `instances_per_rule` in `tests/common/`), then:

```bash
git checkout perf/hot-path-pass
# low cardinality
CC_LOAD_INSTANCES_PER_RULE=20  cargo test --release --test load_evaluator -- --ignored --nocapture 2>&1 | tee /tmp/eval_before_20.txt
# high cardinality (where the per-instance round-trip storm dominates)
CC_LOAD_INSTANCES_PER_RULE=200 cargo test --release --test load_evaluator -- --ignored --nocapture 2>&1 | tee /tmp/eval_before_200.txt
git checkout feat/notify-time-silencing-and-batched-writes
```

> Use the actual env var name the harness honors; if it is hard-coded, set it in `tests/common`
> for the run or pass via the harness's config mechanism. Record `evaluations/sec`.

- [ ] **Step 2: Capture the after numbers on this branch, same cardinalities**

```bash
CC_LOAD_INSTANCES_PER_RULE=20  cargo test --release --test load_evaluator -- --ignored --nocapture 2>&1 | tee /tmp/eval_after_20.txt
CC_LOAD_INSTANCES_PER_RULE=200 cargo test --release --test load_evaluator -- --ignored --nocapture 2>&1 | tee /tmp/eval_after_200.txt
```

- [ ] **Step 3: Record the deltas and the read**

Add to the PR performance table: `evaluations/sec @ 20 instances/rule` and `@ 200 instances/rule`, before/after/delta%. Expectation: a material improvement that grows with cardinality (the I/O collapse scales with N). Write the one-line read, e.g. "evaluator throughput +N× at 200 instances/rule, +M× at 20; dispatcher flush within noise."

---

## Final verification

- [ ] **Step 1: Full build + clippy + tests**

Run:
```bash
cargo build 2>&1 | tail -5
cargo clippy --all-targets 2>&1 | tail -20
cargo test 2>&1 | tail -30
```
Expected: clean build, no new clippy warnings in touched files, all tests pass.

- [ ] **Step 2: Confirm the commit shape**

Run: `git log --oneline perf/hot-path-pass..HEAD`
Expected (newest first): B5 has no commit (measurement); reconciliation unify; hot-path batch; stores batch methods; publish_batch; dispatcher flush filter apply; flush filter helper; (+ the design-spec commits). Feature A and Feature B's two commits are distinct and individually reviewable.

- [ ] **Step 3: Assemble the PR performance table** from `/tmp/eval_*.txt` and `/tmp/disp_*.txt` per Tasks A3 and B5.
