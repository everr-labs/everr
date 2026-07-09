# Postgres/Redis I/O Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the evaluator's per-instance Postgres round-trips into one batched transaction, and process the dispatcher's consume batch concurrently — raising sustained throughput on the two I/O-bound hot paths.

**Architecture:** Phase 1 adds `persist_eval_batch` (one transaction: multi-row `unnest` instance upsert + multi-row outbox insert) and `delete_outbox_batch`, and rewires `evaluate_rule_against_rows` to collect-then-batch. Phase 2 extracts a shared concurrent `process_event_batch` used by both `run_dispatcher` and the load harness. Both changes are behavior-preserving.

**Tech Stack:** Rust, sqlx/Postgres (array `unnest` bulk upsert), Redis, tokio, `futures::join_all`.

**Reference spec:** `docs/superpowers/specs/2026-06-15-io-batching-design.md`

## Verification note

Postgres IT tests and the load harness need Docker. Cargo-sandboxed implementer subagents run the **compile gate** (`cargo test <target> --no-run`) + `cargo clippy`; the controller runs the Docker-backed IT tests and the harness before/after passes.

---

## Task 1: `persist_eval_batch` + `delete_outbox_batch` (store)

**Files:**
- Modify: `crates/stores/src/pg.rs`
- Test: `crates/stores/tests/persist_batch_it.rs` (create)

- [ ] **Step 1: Write the failing IT test**

Create `crates/stores/tests/persist_batch_it.rs`:

```rust
use cc_domain::ids::{InstanceKey, TenantId};
use cc_domain::instance::{InstanceState, Status};
use cc_domain::rule::{RuleSpec, Severity};
use cc_domain::{Event, EventKind, EventStatus};
use cc_stores::PgStore;
use std::collections::BTreeMap;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

async fn store() -> (PgStore, impl Sized) {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    (store, node)
}

fn inst(rule: cc_domain::ids::RuleId, tenant: &TenantId, n: usize, value: f64) -> InstanceState {
    let labels = BTreeMap::from([("svc".to_string(), format!("svc-{n}"))]);
    let mut s = InstanceState::new_inactive(InstanceKey::new(rule, &labels), rule, tenant.clone(), labels);
    s.status = Status::Firing;
    s.value = Some(value);
    s.last_seen = Some(OffsetDateTime::UNIX_EPOCH);
    s
}

#[tokio::test]
async fn persist_eval_batch_upserts_and_outboxes() {
    let (store, _node) = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let spec = RuleSpec {
        sql: "SELECT 1".into(),
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec!["svc".into()],
        value_column: Some("v".into()),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
    };
    let rule = store.create_rule(tenant.clone(), &spec).await.unwrap();

    // Empty input is a no-op returning no ids.
    assert!(store.persist_eval_batch(&[], &[]).await.unwrap().is_empty());

    // Batch-insert 3 instances, 1 with an outbox event.
    let instances: Vec<InstanceState> = (0..3).map(|i| inst(rule.id, &tenant, i, i as f64)).collect();
    let ev = Event {
        tenant: tenant.clone(),
        rule: rule.id,
        instance_key: instances[0].key.clone(),
        status: EventStatus::Firing,
        kind: EventKind::Alert,
        labels: instances[0].labels.clone(),
        value: Some(0.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    };
    let ids = store.persist_eval_batch(&instances, std::slice::from_ref(&ev)).await.unwrap();
    assert_eq!(ids.len(), 1, "one outbox id per event");

    let loaded = store.load_instances(rule.id).await.unwrap();
    assert_eq!(loaded.len(), 3, "all instances persisted");

    // ON CONFLICT update: re-persist same keys with a new value.
    let updated: Vec<InstanceState> = (0..3).map(|i| inst(rule.id, &tenant, i, 99.0)).collect();
    store.persist_eval_batch(&updated, &[]).await.unwrap();
    let reloaded = store.load_instances(rule.id).await.unwrap();
    assert_eq!(reloaded.len(), 3, "still 3 (upsert, not insert)");
    assert!(reloaded.iter().all(|s| s.value == Some(99.0)), "values updated via ON CONFLICT");

    // The outbox row exists; delete_outbox_batch removes it.
    store.delete_outbox_batch(&ids).await.unwrap();
    // A second delete of the same ids is a harmless no-op.
    store.delete_outbox_batch(&ids).await.unwrap();
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p cc-stores --test persist_batch_it --no-run`
Expected: FAIL — `persist_eval_batch` / `delete_outbox_batch` not found.

- [ ] **Step 3: Implement `persist_eval_batch` + `delete_outbox_batch`**

In `crates/stores/src/pg.rs`, in the `impl PgStore` block (near `upsert_instance_with_outbox`), add:

```rust
    /// Persist a batch of instance next-states and, atomically, an outbox row per event, in
    /// ONE transaction. Returns the generated outbox ids in `events` order (for the
    /// publish-then-delete dance). Empty input is a no-op. The whole rule evaluation thus
    /// commits all-or-nothing.
    ///
    /// `unnest` arrays give a fixed 9-param upsert regardless of N, so there is no parameter
    /// limit; a pathologically large instance set could be chunked into successive
    /// transactions if lock duration ever became a concern (not needed today).
    pub async fn persist_eval_batch(
        &self,
        instances: &[InstanceState],
        events: &[Event],
    ) -> Result<Vec<Uuid>, StoreError> {
        if instances.is_empty() && events.is_empty() {
            return Ok(Vec::new());
        }

        let n = instances.len();
        let mut keys = Vec::with_capacity(n);
        let mut rules = Vec::with_capacity(n);
        let mut tenants = Vec::with_capacity(n);
        let mut statuses = Vec::with_capacity(n);
        let mut labels_arr = Vec::with_capacity(n);
        let mut values = Vec::with_capacity(n);
        let mut active = Vec::with_capacity(n);
        let mut last_seen = Vec::with_capacity(n);
        let mut absent = Vec::with_capacity(n);
        for s in instances {
            keys.push(s.key.0.clone());
            rules.push(s.rule.0);
            tenants.push(s.tenant.as_str().to_string());
            statuses.push(status_str(s.status).to_string());
            labels_arr.push(serde_json::to_value(&s.labels)?);
            values.push(s.value);
            active.push(s.active_since);
            last_seen.push(s.last_seen);
            absent.push(absent_count_to_db(s.absent_count));
        }

        let ids: Vec<Uuid> = (0..events.len()).map(|_| Uuid::new_v4()).collect();
        let ev_tenants: Vec<String> = events.iter().map(|e| e.tenant.as_str().to_string()).collect();
        let payloads: Vec<serde_json::Value> = events
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<_, _>>()?;

        let mut tx = self.pool.begin().await?;
        if !instances.is_empty() {
            sqlx::query(
                "INSERT INTO instances (key, rule, tenant, status, labels, value, active_since, last_seen, absent_count)
                 SELECT * FROM unnest($1::text[], $2::uuid[], $3::text[], $4::text[], $5::jsonb[], $6::float8[], $7::timestamptz[], $8::timestamptz[], $9::int[])
                 ON CONFLICT (key) DO UPDATE SET
                   status=EXCLUDED.status, labels=EXCLUDED.labels, value=EXCLUDED.value,
                   active_since=EXCLUDED.active_since, last_seen=EXCLUDED.last_seen, absent_count=EXCLUDED.absent_count",
            )
            .bind(&keys)
            .bind(&rules)
            .bind(&tenants)
            .bind(&statuses)
            .bind(&labels_arr)
            .bind(&values)
            .bind(&active)
            .bind(&last_seen)
            .bind(&absent)
            .execute(&mut *tx)
            .await?;
        }
        if !events.is_empty() {
            sqlx::query(
                "INSERT INTO event_outbox (id, tenant, payload)
                 SELECT * FROM unnest($1::uuid[], $2::text[], $3::jsonb[])",
            )
            .bind(&ids)
            .bind(&ev_tenants)
            .bind(&payloads)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(ids)
    }

    /// Delete a set of outbox rows after their events published successfully. Empty no-op.
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

- [ ] **Step 4: Compile-gate**

Run: `cargo test -p cc-stores --test persist_batch_it --no-run`
Expected: compiles clean.
Run: `cargo clippy -p cc-stores --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/stores/src/pg.rs crates/stores/tests/persist_batch_it.rs
git commit -m "Add batched persist_eval_batch + delete_outbox_batch to the store"
```

(The controller runs `cargo test -p cc-stores --test persist_batch_it` against Docker to confirm green before Task 2.)

---

## Task 2: Rewire `evaluate_rule_against_rows` to collect-then-batch

**Files:**
- Modify: `crates/evaluator/src/lib.rs`

- [ ] **Step 1: Replace the present/absent loops + `publish_transition`**

In `crates/evaluator/src/lib.rs`, replace the body of `evaluate_rule_against_rows` (the present loop, absent loop, and the trailing `Ok(())`) so it collects next-states and events, persists once, then publishes + batch-deletes. The `present`/`known_keys` setup at the top is unchanged. New version of the two loops + persistence:

```rust
    // 1) Evaluate every present row, then every previously-known-but-absent instance.
    // Collect all next-states (for one batched upsert) and the subset that produced an
    // event (for one batched outbox insert) instead of writing per instance.
    let mut next_states: Vec<InstanceState> = Vec::new();
    let mut out_events: Vec<Event> = Vec::new();

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
        next_states.push(out.next);
    }

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
        next_states.push(out.next);
    }

    // 2) One transaction: upsert all next-states + insert all outbox rows atomically.
    let outbox_ids = store.persist_eval_batch(&next_states, &out_events).await?;

    // 3) Publish each event; on success its outbox row is deleted (batched). A failed
    // publish (or a crash before delete) leaves the row for the maintenance relay —
    // exactly-once relative to the committed state is unchanged.
    let mut published: Vec<uuid::Uuid> = Vec::new();
    for (ev, id) in out_events.iter().zip(outbox_ids.iter()) {
        match events.publish(ev).await {
            Ok(()) => published.push(*id),
            Err(e) => tracing::warn!(error = %e, "publish failed; relay will recover from outbox"),
        }
    }
    if let Err(e) = store.delete_outbox_batch(&published).await {
        tracing::warn!(error = %e, "outbox batch delete failed; relay will re-publish");
    }

    Ok(())
}
```

- [ ] **Step 2: Delete the now-unused `publish_transition`**

`publish_transition` (the `async fn publish_transition(...)` that matched on `event` and called `upsert_instance` / `upsert_instance_with_outbox`) is no longer referenced. Delete the whole function. Leave `publish_health` untouched.

- [ ] **Step 3: Compile-gate + clippy**

Run: `cargo build -p cc-evaluator`
Expected: compiles. (If `upsert_instance`/`upsert_instance_with_outbox`/`delete_outbox` are now unused *in the evaluator*, that's fine — they remain `pub` on the store and are used elsewhere/by the relay; do not delete them.)
Run: `cargo clippy -p cc-evaluator --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 4: Run the evaluator's own tests (compile-gate; controller runs Docker IT)**

Run: `cargo test -p cc-evaluator --no-run`
Expected: compiles. The existing `coalescing_it` and unit tests must still pass when the controller runs them with Docker — the change is behavior-preserving.

- [ ] **Step 5: Commit**

```bash
git add crates/evaluator/src/lib.rs
git commit -m "Batch evaluator persistence into one transaction per rule"
```

---

## Task 3: Phase 1 verification + before/after (controller, Docker)

**Files:** none (measurement).

- [ ] **Step 1: Run the new store IT test**

Run: `cargo test -p cc-stores --test persist_batch_it -- --nocapture`
Expected: PASS.

- [ ] **Step 2: Run the evaluator + e2e durability tests**

Run: `cargo test -p cc-evaluator` and `cargo test --test e2e_durability`
Expected: all PASS (behavior preserved, outbox/durability intact).

- [ ] **Step 3: Harness before/after**

Run: `cargo test --release --test load_evaluator -- --ignored --nocapture`
Record the new `rules/sec` / `evaluations/sec` vs the pre-change baseline (~337 / ~6748). Expect a sharp rise (per-rule round-trips ~23 → ~4).

No commit (measurement only); report the numbers.

---

## Task 4: Concurrent `process_event_batch` + `run_dispatcher` (dispatcher)

**Files:**
- Modify: `crates/dispatcher/Cargo.toml`
- Modify: `crates/dispatcher/src/lib.rs`

- [ ] **Step 1: Add the `futures` dependency**

In `crates/dispatcher/Cargo.toml` `[dependencies]`, add:

```toml
futures = "0.3"
```

- [ ] **Step 2: Add `process_event_batch`**

In `crates/dispatcher/src/lib.rs`, add (near `process_event`):

```rust
/// Process a consumed batch concurrently, returning the ack decision per entry. Each
/// `process_event` future is independent; `join_all` overlaps their Redis round-trips over
/// the multiplexed connection without spawning (borrowed refs, no `'static` needed). Public
/// so the load harness drives the same path production does; not a stable API.
pub async fn process_event_batch(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    groups: &dyn GroupStore,
    cache: &FilterCache,
    cipher: &dyn SecretCipher,
    entries: &[EventEntry],
) -> Vec<(cc_queue::EventId, bool)> {
    futures::future::join_all(entries.iter().map(|entry| async move {
        let ack = process_event(store, bus, notifiers, groups, cache, cipher, entry).await;
        (entry.id.clone(), ack)
    }))
    .await
}
```

(Confirm `EventEntry`, `EventId`, `GroupStore`, `Notifiers`, `FilterCache`, `SecretCipher` are already imported in this file — they are, via the existing `process_event`/`run_dispatcher`. Add `use cc_queue::EventId;` only if the bare name isn't in scope; otherwise the fully-qualified `cc_queue::EventId` in the return type suffices.)

- [ ] **Step 3: Use it in `run_dispatcher`**

In `run_dispatcher`, replace the sequential inner loop:

```rust
        for entry in entries {
            let ack_ok = process_event(
                &store,
                bus.as_ref(),
                notifiers.as_ref(),
                groups.as_ref(),
                cache.as_ref(),
                cipher.as_ref(),
                &entry,
            )
            .await;
            if ack_ok {
                if let Err(e) = bus.ack(&entry.id).await {
                    tracing::error!(error = %e, "event ack failed");
                }
            }
            // if !ack_ok: entry stays in the PEL (unacked) — preserved for Phase 3 reclaim.
        }
```

with:

```rust
        let acks = process_event_batch(
            &store,
            bus.as_ref(),
            notifiers.as_ref(),
            groups.as_ref(),
            cache.as_ref(),
            cipher.as_ref(),
            &entries,
        )
        .await;
        for (id, ack_ok) in acks {
            if ack_ok {
                if let Err(e) = bus.ack(&id).await {
                    tracing::error!(error = %e, "event ack failed");
                }
            }
            // if !ack_ok: entry stays in the PEL (unacked) — preserved for Phase 3 reclaim.
        }
```

- [ ] **Step 4: Compile-gate + clippy**

Run: `cargo build -p cc-dispatcher`
Expected: compiles.
Run: `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 5: Compile the dispatcher tests (controller runs Docker e2e)**

Run: `cargo test -p cc-dispatcher --no-run`
Expected: compiles. The e2e dispatch/grouping/routing tests must still pass under Docker — behavior preserved.

- [ ] **Step 6: Commit**

```bash
git add crates/dispatcher/Cargo.toml crates/dispatcher/src/lib.rs
git commit -m "Process dispatcher consume batch concurrently via process_event_batch"
```

---

## Task 5: Harness ingest worker uses `process_event_batch`

**Files:**
- Modify: `tests/load_dispatcher.rs`

- [ ] **Step 1: Rewire the ingest worker loop**

In `tests/load_dispatcher.rs`, in `load_dispatcher_ingest_throughput`, replace the per-entry inner processing:

```rust
                let n = entries.len();
                for e in &entries {
                    let ack = process_event(
                        &store,
                        bus.as_ref(),
                        &notifiers,
                        groups.as_ref(),
                        &cache,
                        cipher.as_ref(),
                        e,
                    )
                    .await;
                    if ack {
                        bus.ack(&e.id).await.unwrap();
                    }
                }
                processed.fetch_add(n, Ordering::Relaxed);
```

with:

```rust
                let n = entries.len();
                let acks = process_event_batch(
                    &store,
                    bus.as_ref(),
                    &notifiers,
                    groups.as_ref(),
                    &cache,
                    cipher.as_ref(),
                    &entries,
                )
                .await;
                for (id, ack) in &acks {
                    if *ack {
                        bus.ack(id).await.unwrap();
                    }
                }
                processed.fetch_add(n, Ordering::Relaxed);
```

- [ ] **Step 2: Apply the same change in `buffer_events`**

In the `buffer_events` helper (same file), replace its identical per-entry processing block with the same `process_event_batch` call shape (so the flush test's buffering also uses the batch path).

- [ ] **Step 3: Update the import**

Change `use cc_dispatcher::{process_event, Notifiers, WebhookNotifier};` to also bring in the batch fn:

```rust
use cc_dispatcher::{process_event_batch, Notifiers, WebhookNotifier};
```

If `process_event` is no longer referenced anywhere in the file after Steps 1–2, drop it from the import to avoid an unused-import warning. (If the flush test still references it, keep both.)

- [ ] **Step 4: Compile-gate + clippy**

Run: `cargo test --release --test load_dispatcher --no-run`
Expected: compiles.
Run: `cargo clippy --test load_dispatcher -- -D warnings`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add tests/load_dispatcher.rs
git commit -m "Drive load harness ingest through process_event_batch"
```

---

## Task 6: Phase 2 verification + before/after (controller, Docker)

**Files:** none (measurement).

- [ ] **Step 1: Run the dispatcher e2e suite**

Run: `cargo test --test e2e_dispatch --test e2e_grouping --test e2e_routing`
Expected: all PASS (behavior preserved).

- [ ] **Step 2: Harness before/after**

Run: `CC_LOAD_EVENTS=50000 cargo test --release --test load_dispatcher load_dispatcher_ingest_throughput -- --ignored --nocapture`
Record `events/sec` vs the pre-change baseline (~5766). Expect a rise from overlapping the per-event Redis round-trips.

Report the numbers. No commit.

---

## Plan self-review

**Spec coverage:**
- §2a `persist_eval_batch` (one tx, unnest upsert + outbox) → Task 1. ✓
- §2a `delete_outbox_batch` → Task 1. ✓
- §2b rewire collect-then-batch + publish + batch-delete → Task 2. ✓
- §2c behavior preservation (remove `publish_transition`, keep outbox/relay protocol) → Task 2. ✓
- §3a `process_event_batch` (join_all, borrowed) → Task 4. ✓
- §3b callers: `run_dispatcher` → Task 4; harness ingest + `buffer_events` → Task 5. ✓
- §4 new IT test → Task 1 Step 1; existing tests green → Tasks 3/6; harness before/after → Tasks 3/6. ✓
- §6 file map matches the tasks. ✓
- `futures` dependency add → Task 4 Step 1. ✓

**Type consistency:** `persist_eval_batch(&[InstanceState], &[Event]) -> Vec<Uuid>` and `delete_outbox_batch(&[Uuid])` used identically in Task 1 (impl), Task 1 test, and Task 2 (caller). `process_event_batch(...) -> Vec<(EventId, bool)>` used identically in Task 4 (def + run_dispatcher) and Task 5 (harness). The array bind types match the single-row `upsert_instance` column types (`status_str`→text, `absent_count_to_db`→int, `serde_json::to_value(labels)`→jsonb, nullable `value`/`active_since`/`last_seen`).

**Placeholder scan:** none — every code step shows full code.

**Open items flagged for implementers:**
- Task 4 Step 2: confirm `EventId` import vs fully-qualified path.
- Task 5 Step 3: drop `process_event` from the import only if no longer referenced.
