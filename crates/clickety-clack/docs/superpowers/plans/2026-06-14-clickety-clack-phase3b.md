# Clickety-Clack Phase 3B — Durability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two durability gaps — lost publishes and hung (never-resolving) alert instances — without regressing hot-path notification latency, plus GC of long-expired silences.

**Architecture:** A transactional event outbox makes `{instance state change + event-to-publish}` atomic in one Postgres transaction; the evaluator still publishes immediately and deletes the outbox row on success (self-cleaning). A lease-singleton maintenance loop runs three sweeps: an outbox **relay** that re-publishes any row outliving a short grace window, a **reconciliation** sweep that auto-resolves instances whose `last_seen` is older than `max(4 × interval_secs, 60s)`, and an hourly expired-**silence GC**.

**Tech Stack:** Rust workspace, tokio, sqlx 0.8 (Postgres, explicit transactions), redis 0.27 (Streams + lease), testcontainers (Postgres + Redis). Spec: `docs/superpowers/specs/2026-06-14-clickety-clack-phase3b-durability.md`.

**Conventions:** TDD bite-sized steps; `cargo clippy --all-targets -- -D warnings` clean; real gate `cargo test --workspace --no-fail-fast`; package disambiguation `-p cc@0.1.0`. No Claude/AI attribution anywhere in commits or code. Branch: `feat/phase3b-durability` (base main `3b5b6d0`, spec committed `a3ca4bb`).

**Note on testcontainers timing:** integration tests start real Docker containers; the bare `cargo test` runs only root e2e. Run the named test crate explicitly (commands given per task). Stale rust-analyzer diagnostics are NOT authoritative — trust `cargo`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `crates/domain/src/event.rs` | `Event` + shared `Event::new` constructor | Modify |
| `crates/engine/src/state_machine.rs` | `make_event` delegates to `Event::new` (anti-drift) | Modify |
| `crates/domain/src/instance.rs` | add `StaleInstance` query-result type | Modify |
| `crates/domain/src/lib.rs` | re-export `StaleInstance` | Modify |
| `migrations/0006_event_outbox.sql` | `event_outbox` table + index | Create |
| `crates/stores/src/pg.rs` | `upsert_instance_with_outbox`, `claim_outbox`, `delete_outbox`, `list_stale_instances`, `gc_silences` | Modify |
| `crates/stores/tests/outbox_it.rs` | ITs for outbox store methods | Create |
| `crates/stores/tests/reconcile_it.rs` | ITs for `list_stale_instances` + `gc_silences` | Create |
| `crates/evaluator/src/lib.rs` | atomic write + delete-on-publish on the event path | Modify |
| `crates/evaluator/src/maintenance.rs` | `is_stale`, `relay_once`, `reconcile_once`, `run_maintenance` | Create |
| `crates/evaluator/tests/maintenance_it.rs` | relay + reconciliation ITs | Create |
| `src/main.rs` | spawn `run_maintenance` on `cc:maintenance:lease` | Modify |
| `tests/e2e_durability.rs` | end-to-end: inline publish fails, relay recovers | Create |

---

### Task 1: Shared `Event::new` constructor (anti-drift)

The reconciliation sweep must build Resolved events identical to the evaluator's. Extract one constructor both call sites use so they cannot diverge.

**Files:**
- Modify: `crates/domain/src/event.rs`
- Modify: `crates/engine/src/state_machine.rs`

- [ ] **Step 1: Add the constructor to `Event`**

Append to `crates/domain/src/event.rs` (after the `Event` struct, before end of file):

```rust
impl Event {
    /// Single constructor for all events. Used by the evaluator's state machine and by
    /// the reconciliation sweep so synthesized events cannot drift from real ones.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        tenant: TenantId,
        rule: RuleId,
        instance_key: InstanceKey,
        status: EventStatus,
        labels: BTreeMap<String, String>,
        value: Option<f64>,
        severity: Severity,
        annotations: BTreeMap<String, String>,
        eval_ts: OffsetDateTime,
    ) -> Self {
        Self {
            tenant,
            rule,
            instance_key,
            status,
            labels,
            value,
            severity,
            annotations,
            eval_ts,
        }
    }
}
```

- [ ] **Step 2: Refactor `make_event` in the engine to delegate**

In `crates/engine/src/state_machine.rs`, replace the `make_event` fn body:

```rust
fn make_event(s: &InstanceState, input: &EvalInput, status: EventStatus) -> Event {
    Event::new(
        s.tenant,
        s.rule,
        s.key.clone(),
        status,
        s.labels.clone(),
        s.value,
        input.severity,
        input.annotations.clone(),
        input.eval_ts,
    )
}
```

- [ ] **Step 3: Add a unit test for the constructor**

Append to `crates/domain/src/event.rs` (new test module at end of file):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::{InstanceKey, RuleId, TenantId};
    use uuid::Uuid;

    #[test]
    fn new_sets_all_fields() {
        let mut labels = BTreeMap::new();
        labels.insert("service".to_string(), "api".to_string());
        let ev = Event::new(
            TenantId(Uuid::nil()),
            RuleId(Uuid::nil()),
            InstanceKey("k".into()),
            EventStatus::Resolved,
            labels.clone(),
            Some(1.0),
            Severity::Critical,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        );
        assert_eq!(ev.status, EventStatus::Resolved);
        assert_eq!(ev.severity, Severity::Critical);
        assert_eq!(ev.labels, labels);
        assert_eq!(ev.value, Some(1.0));
    }
}
```

Check `crates/domain/Cargo.toml` has `uuid` under `[dev-dependencies]` or `[dependencies]`. It already depends on `uuid` (used by `ids`). If `uuid` is only a normal dep that is fine for `#[cfg(test)]` use.

- [ ] **Step 4: Run tests**

Run: `cargo test -p cc-domain -p cc-engine`
Expected: PASS, including existing engine state-machine tests (they now route through `Event::new`).

- [ ] **Step 5: Clippy + commit**

Run: `cargo clippy -p cc-domain -p cc-engine --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/domain/src/event.rs crates/engine/src/state_machine.rs
git commit -m "Add shared Event::new constructor; engine delegates to it"
```

---

### Task 2: `StaleInstance` domain type

The reconciliation query returns instances enriched with severity + annotations (read from the rule spec), mirroring `FiringInstance` from 3A.

**Files:**
- Modify: `crates/domain/src/instance.rs`
- Modify: `crates/domain/src/lib.rs`

- [ ] **Step 1: Add the struct**

Append to `crates/domain/src/instance.rs` (after `FiringInstance`):

```rust
/// An instance that has gone stale (no recent evaluation) while still pending or firing,
/// enriched with its rule's severity + annotations so the reconciliation sweep can
/// synthesize a Resolved event. `severity`/`annotations` are read from the rule spec.
#[derive(Debug, Clone, PartialEq)]
pub struct StaleInstance {
    pub key: InstanceKey,
    pub rule: RuleId,
    pub tenant: TenantId,
    pub status: Status,
    pub labels: BTreeMap<String, String>,
    pub value: Option<f64>,
    pub severity: Severity,
    pub annotations: BTreeMap<String, String>,
}
```

- [ ] **Step 2: Re-export it**

In `crates/domain/src/lib.rs`, find the line re-exporting instance types (it re-exports `FiringInstance`) and add `StaleInstance`. For example if the line reads:

```rust
pub use instance::{FiringInstance, InstanceState, Status};
```

change it to:

```rust
pub use instance::{FiringInstance, InstanceState, StaleInstance, Status};
```

(If the existing re-export list differs, just add `StaleInstance` to it.)

- [ ] **Step 3: Build**

Run: `cargo build -p cc-domain`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add crates/domain/src/instance.rs crates/domain/src/lib.rs
git commit -m "Add StaleInstance domain type for reconciliation sweep"
```

---

### Task 3: Migration `0006_event_outbox.sql`

Self-cleaning outbox table. `id` is generated in Rust (matches the `silences` table pattern — no DB default), so no `gen_random_uuid()` dependency.

**Files:**
- Create: `migrations/0006_event_outbox.sql`

- [ ] **Step 1: Write the migration**

Create `migrations/0006_event_outbox.sql`:

```sql
-- Transactional event outbox. A row is written in the same transaction as the
-- instance state change, then deleted on successful publish. The relay re-publishes
-- any row that outlives the grace window (publish errored or process crashed).
CREATE TABLE event_outbox (
    id         UUID PRIMARY KEY,
    tenant     UUID NOT NULL,
    payload    JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The relay scans oldest-first for rows past the grace window.
CREATE INDEX event_outbox_created ON event_outbox (created_at);
```

- [ ] **Step 2: Verify it applies**

The migration is exercised by every store IT (each calls `store.migrate()`). A dedicated check happens in Task 4. For now just confirm the file is well-formed SQL by building the workspace (sqlx `migrate!` embeds at compile time):

Run: `cargo build -p cc-stores`
Expected: compiles (the `migrate!` macro globs the migrations dir).

- [ ] **Step 3: Commit**

```bash
git add migrations/0006_event_outbox.sql
git commit -m "Add 0006_event_outbox migration"
```

---

### Task 4: Store — `upsert_instance_with_outbox`, `claim_outbox`, `delete_outbox`

The atomicity primitive (explicit transaction) plus the relay's claim/delete methods. All three are tested together because the ITs use `claim_outbox` to assert what `upsert_instance_with_outbox` wrote.

**Files:**
- Modify: `crates/stores/src/pg.rs`
- Test: `crates/stores/tests/outbox_it.rs`

- [ ] **Step 1: Add the imports/uses needed**

`crates/stores/src/pg.rs` already imports `cc_domain::Event`? Check the top imports. It imports many `cc_domain::*` items but NOT `Event`. Add to the imports block at the top of `pg.rs`:

```rust
use cc_domain::Event;
use std::time::Duration;
```

(`Duration` from `std::time` is used by the relay's grace; `time::OffsetDateTime` is already imported.)

- [ ] **Step 2: Add the three methods**

Add inside `impl PgStore { ... }` in `crates/stores/src/pg.rs` (place near `upsert_instance`):

```rust
    /// Atomic write of an instance state change AND its event-to-publish, in one
    /// transaction. Returns the new outbox row id (used to delete the row after a
    /// successful publish). This is the durability primitive: the event can never be
    /// lost relative to the state write.
    pub async fn upsert_instance_with_outbox(
        &self,
        s: &InstanceState,
        ev: &Event,
    ) -> Result<Uuid, StoreError> {
        let labels = serde_json::to_value(&s.labels)?;
        let payload = serde_json::to_value(ev)?;
        let id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO instances (key, rule, tenant, status, labels, value, active_since, last_seen, absent_count)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (key) DO UPDATE SET
               status=$4, labels=$5, value=$6, active_since=$7, last_seen=$8, absent_count=$9",
        )
        .bind(&s.key.0)
        .bind(s.rule.0)
        .bind(s.tenant.0)
        .bind(status_str(s.status))
        .bind(&labels)
        .bind(s.value)
        .bind(s.active_since)
        .bind(s.last_seen)
        .bind(absent_count_to_db(s.absent_count))
        .execute(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO event_outbox (id, tenant, payload) VALUES ($1,$2,$3)")
            .bind(id)
            .bind(ev.tenant.0)
            .bind(&payload)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(id)
    }

    /// Claim outbox rows created strictly before `cutoff` (the grace boundary),
    /// oldest first. `FOR UPDATE SKIP LOCKED` is belt-and-suspenders against a lease
    /// hand-off race; the relay is normally a singleton.
    pub async fn claim_outbox(
        &self,
        cutoff: OffsetDateTime,
        batch: i64,
    ) -> Result<Vec<(Uuid, Event)>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, payload FROM event_outbox
             WHERE created_at < $1
             ORDER BY created_at
             LIMIT $2
             FOR UPDATE SKIP LOCKED",
        )
        .bind(cutoff)
        .bind(batch)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let id: Uuid = r.get("id");
            let ev: Event = serde_json::from_value(r.get("payload"))?;
            out.push((id, ev));
        }
        Ok(out)
    }

    /// Delete one outbox row after its event was published successfully.
    pub async fn delete_outbox(&self, id: Uuid) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM event_outbox WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
```

Note: `absent_count_to_db` and `status_str` are existing helpers in `pg.rs`. If `absent_count_to_db` does not exist, the existing `upsert_instance` shows the exact binding used for `absent_count` — copy that expression verbatim (it binds `s.absent_count` possibly cast). Use the SAME expression `upsert_instance` uses for the `absent_count` bind so the two writes are identical.

- [ ] **Step 3: Write the failing IT**

Create `crates/stores/tests/outbox_it.rs`:

```rust
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, TenantId};
use cc_domain::instance::{InstanceState, Status};
use cc_domain::rule::{RuleSpec, Severity};
use cc_stores::PgStore;
use std::collections::BTreeMap;
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

async fn store() -> (PgStore, testcontainers_modules::testcontainers::ContainerAsync<Postgres>) {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    (store, node)
}

fn firing_instance(rule: cc_domain::ids::RuleId, tenant: TenantId) -> (InstanceState, Event) {
    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), "api".to_string());
    let key = InstanceKey::new(rule, &labels);
    let mut inst = InstanceState::new_inactive(key.clone(), rule, tenant, labels.clone());
    inst.status = Status::Firing;
    inst.value = Some(5.0);
    inst.last_seen = Some(OffsetDateTime::UNIX_EPOCH);
    let ev = Event::new(
        tenant,
        rule,
        key,
        EventStatus::Firing,
        labels,
        Some(5.0),
        Severity::Warning,
        BTreeMap::new(),
        OffsetDateTime::UNIX_EPOCH,
    );
    (inst, ev)
}

#[tokio::test]
async fn upsert_with_outbox_writes_both_and_claim_returns_event() {
    let (store, _node) = store().await;
    let tenant = TenantId(Uuid::new_v4());
    let rule = store.create_rule(tenant, &spec()).await.unwrap();
    let (inst, ev) = firing_instance(rule.id, tenant);

    let id = store.upsert_instance_with_outbox(&inst, &ev).await.unwrap();

    // Instance was written.
    let loaded = store.load_instances(rule.id).await.unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].status, Status::Firing);

    // Outbox row was written and round-trips to the same event.
    let claimed = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 100)
        .await
        .unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].0, id);
    assert_eq!(claimed[0].1, ev);

    // Delete removes it.
    store.delete_outbox(id).await.unwrap();
    let after = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 100)
        .await
        .unwrap();
    assert!(after.is_empty());
}

#[tokio::test]
async fn claim_respects_grace_cutoff() {
    let (store, _node) = store().await;
    let tenant = TenantId(Uuid::new_v4());
    let rule = store.create_rule(tenant, &spec()).await.unwrap();
    let (inst, ev) = firing_instance(rule.id, tenant);
    store.upsert_instance_with_outbox(&inst, &ev).await.unwrap();

    // Cutoff in the past: the just-created row is NOT yet past its grace window.
    let past = store
        .claim_outbox(OffsetDateTime::now_utc() - Duration::hours(1), 100)
        .await
        .unwrap();
    assert!(past.is_empty(), "fresh row must not be claimed before grace");

    // Cutoff in the future: row is claimable.
    let future = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 100)
        .await
        .unwrap();
    assert_eq!(future.len(), 1);
}

#[tokio::test]
async fn upsert_with_outbox_rolls_back_on_failure() {
    let (store, _node) = store().await;
    let tenant = TenantId(Uuid::new_v4());
    // Build an instance referencing a rule id that does NOT exist -> the instances
    // INSERT violates the foreign key -> the whole transaction must roll back, leaving
    // no orphaned outbox row.
    let bogus_rule = cc_domain::ids::RuleId(Uuid::new_v4());
    let (mut inst, mut ev) = firing_instance(bogus_rule, tenant);
    inst.rule = bogus_rule;
    ev.rule = bogus_rule;

    let res = store.upsert_instance_with_outbox(&inst, &ev).await;
    assert!(res.is_err(), "FK violation should fail the write");

    let claimed = store
        .claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 100)
        .await
        .unwrap();
    assert!(claimed.is_empty(), "outbox row must roll back with the failed instance write");
}
```

- [ ] **Step 4: Run it (fails first if methods absent, then passes)**

Run: `cargo test -p cc-stores --test outbox_it`
Expected: PASS (Docker Postgres). If `ContainerAsync` import path differs, mirror the path used in `crates/stores/tests/pg_it.rs` / `silences_it.rs` (the helper returning a kept-alive node). Keep the `_node` binding alive for the whole test.

- [ ] **Step 5: Clippy + commit**

Run: `cargo clippy -p cc-stores --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/stores/src/pg.rs crates/stores/tests/outbox_it.rs
git commit -m "Add transactional outbox store methods (upsert_with_outbox, claim, delete)"
```

---

### Task 5: Store — `list_stale_instances` + `gc_silences`

The reconciliation query (SQL-side staleness filter, mirrors `list_firing`'s JOIN) and the silence GC delete.

**Files:**
- Modify: `crates/stores/src/pg.rs`
- Test: `crates/stores/tests/reconcile_it.rs`

- [ ] **Step 1: Add a status parser helper**

`pg.rs` has `status_str(Status) -> &str` but no reverse. Add near `status_str`:

```rust
fn status_from_str(s: &str) -> Status {
    match s {
        "pending" => Status::Pending,
        "firing" => Status::Firing,
        _ => Status::Inactive,
    }
}
```

- [ ] **Step 2: Add the two methods**

Add inside `impl PgStore { ... }`. Import `StaleInstance` — add `StaleInstance` to the existing `use cc_domain::instance::{...}` line at the top of `pg.rs` (currently `{FiringInstance, InstanceState, Status}` → add `StaleInstance`).

```rust
    /// Instances still pending/firing whose last evaluation is older than
    /// max(4 * interval_secs, 60s) — i.e. the rule effectively stopped being evaluated.
    /// Enriched with severity + annotations from the rule spec so the caller can
    /// synthesize a Resolved event. `now` is passed in for testability.
    ///
    /// The SQL staleness formula GREATEST(4 * interval_secs, 60) MUST mirror
    /// `cc_evaluator::maintenance::staleness_threshold_secs`.
    pub async fn list_stale_instances(
        &self,
        now: OffsetDateTime,
    ) -> Result<Vec<StaleInstance>, StoreError> {
        let rows = sqlx::query(
            "SELECT i.key AS key, i.rule AS rule, i.tenant AS tenant, i.status AS status,
                    i.labels AS labels, i.value AS value, r.spec AS spec
             FROM instances i JOIN rules r ON r.id = i.rule
             WHERE i.status IN ('pending','firing')
               AND i.last_seen < ($1::timestamptz
                   - make_interval(secs => GREATEST(4 * (r.spec->>'interval_secs')::int, 60)))",
        )
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let labels: BTreeMap<String, String> = serde_json::from_value(r.get("labels"))?;
            let spec: RuleSpec = serde_json::from_value(r.get("spec"))?;
            let status_s: String = r.get("status");
            out.push(StaleInstance {
                key: InstanceKey(r.get("key")),
                rule: RuleId(r.get("rule")),
                tenant: TenantId(r.get("tenant")),
                status: status_from_str(&status_s),
                labels,
                value: r.get("value"),
                severity: spec.severity,
                annotations: spec.annotations,
            });
        }
        Ok(out)
    }

    /// Delete silences whose end time is before `cutoff` (housekeeping). Returns the
    /// number of rows removed.
    pub async fn gc_silences(&self, cutoff: OffsetDateTime) -> Result<u64, StoreError> {
        let res = sqlx::query("DELETE FROM silences WHERE ends_at < $1")
            .bind(cutoff)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected())
    }
```

- [ ] **Step 3: Write the IT**

Create `crates/stores/tests/reconcile_it.rs`:

```rust
use cc_domain::ids::{InstanceKey, TenantId};
use cc_domain::instance::{InstanceState, Status};
use cc_domain::routing::{MatchOp, Matcher};
use cc_domain::rule::{RuleSpec, Severity};
use cc_stores::PgStore;
use std::collections::BTreeMap;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

fn spec_interval(interval_secs: u32) -> RuleSpec {
    RuleSpec {
        sql: "SELECT 1".into(),
        interval_secs,
        for_secs: 0,
        label_columns: vec![],
        value_column: None,
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        resolve_after: 1,
    }
}

async fn store() -> (PgStore, testcontainers_modules::testcontainers::ContainerAsync<Postgres>) {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();
    (store, node)
}

fn instance(rule: cc_domain::ids::RuleId, tenant: TenantId, name: &str, status: Status, last_seen: OffsetDateTime) -> InstanceState {
    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), name.to_string());
    let key = InstanceKey::new(rule, &labels);
    let mut s = InstanceState::new_inactive(key, rule, tenant, labels);
    s.status = status;
    s.last_seen = Some(last_seen);
    s.active_since = Some(last_seen);
    s
}

#[tokio::test]
async fn stale_query_uses_per_rule_interval() {
    let (store, _node) = store().await;
    let tenant = TenantId(Uuid::new_v4());
    // interval 30s -> threshold = max(120,60) = 120s.
    let rule = store.create_rule(tenant, &spec_interval(30)).await.unwrap();
    let now = OffsetDateTime::now_utc();

    // Fresh firing (last_seen 10s ago) -> NOT stale.
    store.upsert_instance(&instance(rule.id, tenant, "fresh", Status::Firing, now - Duration::seconds(10))).await.unwrap();
    // Old firing (last_seen 5 min ago) -> stale.
    store.upsert_instance(&instance(rule.id, tenant, "old-fire", Status::Firing, now - Duration::seconds(300))).await.unwrap();
    // Old pending -> stale.
    store.upsert_instance(&instance(rule.id, tenant, "old-pend", Status::Pending, now - Duration::seconds(300))).await.unwrap();
    // Old inactive -> never stale (excluded by status filter).
    store.upsert_instance(&instance(rule.id, tenant, "old-inact", Status::Inactive, now - Duration::seconds(300))).await.unwrap();

    let stale = store.list_stale_instances(now).await.unwrap();
    let names: std::collections::BTreeSet<String> = stale
        .iter()
        .map(|s| s.labels.get("service").cloned().unwrap())
        .collect();
    assert_eq!(names, ["old-fire".to_string(), "old-pend".to_string()].into_iter().collect());
    // Severity is read from the rule spec.
    assert!(stale.iter().all(|s| s.severity == Severity::Critical));
}

#[tokio::test]
async fn gc_silences_deletes_only_expired_before_cutoff() {
    let (store, _node) = store().await;
    let tenant = TenantId(Uuid::new_v4());
    let now = OffsetDateTime::now_utc();
    let m = vec![Matcher { name: "service".into(), op: MatchOp::Eq, value: "api".into() }];

    // Expired long ago.
    store.create_silence(tenant, &m, now - Duration::days(3), now - Duration::days(2), "old", "t").await.unwrap();
    // Still active.
    store.create_silence(tenant, &m, now - Duration::hours(1), now + Duration::hours(1), "active", "t").await.unwrap();

    let cutoff = now - Duration::days(1);
    let deleted = store.gc_silences(cutoff).await.unwrap();
    assert_eq!(deleted, 1, "only the long-expired silence is removed");

    let active = store.list_active_silences(tenant, now).await.unwrap();
    assert_eq!(active.len(), 1);
}
```

Note: confirm `Matcher`/`MatchOp` field names against `crates/domain/src/routing.rs` (3A used these). If the field is `op` of type `MatchOp` with a variant `Eq`, the above is correct; otherwise mirror exactly what `crates/api/tests/silences_api.rs` or `crates/dispatcher/src/matching.rs` use to build a `Matcher`.

- [ ] **Step 4: Run it**

Run: `cargo test -p cc-stores --test reconcile_it`
Expected: PASS.

- [ ] **Step 5: Clippy + commit**

Run: `cargo clippy -p cc-stores --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/stores/src/pg.rs crates/stores/tests/reconcile_it.rs
git commit -m "Add list_stale_instances + gc_silences store methods"
```

---

### Task 6: Evaluator — atomic write + delete-on-publish

Switch the event path to write through the outbox transactionally, then publish, then delete on success. Non-event instance writes are unchanged.

**Files:**
- Modify: `crates/evaluator/src/lib.rs`

- [ ] **Step 1: Restructure the publish path**

In `crates/evaluator/src/lib.rs`, the current code (a) calls `store.upsert_instance(&out.next)` and pushes events into `events_out`, then (b) publishes all of `events_out` in a final loop. Replace that pattern so the event and its state write are atomic.

Replace the two evaluation loops' bodies — specifically the lines:

```rust
        let out = evaluate(prev, input);
        store.upsert_instance(&out.next).await?;
        if let Some(ev) = out.event {
            events_out.push(ev);
        }
```

(which appear twice — present-path and absence-path) with:

```rust
        let out = evaluate(prev, input);
        publish_transition(store, events, &out.next, out.event).await?;
```

Then DELETE the trailing block that drains `events_out` (the `// 3) Publish events...` loop) and the `let mut events_out: Vec<Event> = Vec::new();` declaration, since publishing now happens inline.

- [ ] **Step 2: Add the helper fn**

Add this free fn to `crates/evaluator/src/lib.rs` (below `process`):

```rust
/// Persist an instance transition and, if it produced an event, do so atomically with
/// an outbox row, then publish immediately and delete the row on success. A failed
/// publish (or a crash before the delete) leaves the row for the maintenance relay to
/// recover — the event is never lost relative to the state write.
async fn publish_transition(
    store: &PgStore,
    events: &dyn EventBus,
    next: &InstanceState,
    event: Option<Event>,
) -> anyhow::Result<()> {
    match event {
        None => {
            store.upsert_instance(next).await?;
        }
        Some(ev) => {
            let id = store.upsert_instance_with_outbox(next, &ev).await?;
            match events.publish(&ev).await {
                Ok(()) => {
                    if let Err(e) = store.delete_outbox(id).await {
                        // Non-fatal: the relay re-publishes (a duplicate the dispatcher
                        // dedups). Leaving the row is the safe choice.
                        tracing::warn!(error = %e, "outbox delete failed; relay will re-publish");
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "publish failed; relay will recover from outbox");
                }
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Verify the build (imports)**

`process` already imports `Event`, `InstanceState`, `PgStore`, `EventBus`. If the compiler flags `events_out` or `Event` as unused after the edit, remove the now-dead `use`/binding. 

Run: `cargo build -p cc-evaluator`
Expected: compiles with no warnings about unused `events_out`.

- [ ] **Step 4: Run existing evaluator-touching tests**

Run: `cargo test --test e2e_dispatch`
Expected: PASS — the dispatcher still receives exactly one firing event (the inline publish succeeds in the happy path; the outbox row is created then deleted). This proves the refactor is behavior-neutral on the happy path.

- [ ] **Step 5: Clippy + commit**

Run: `cargo clippy -p cc-evaluator --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/evaluator/src/lib.rs
git commit -m "Evaluator: write instance+event atomically via outbox, delete on publish"
```

---

### Task 7: Maintenance module — `is_stale`, `relay_once`, `reconcile_once`, `run_maintenance`

The lease-singleton background loop and its three sweeps. `relay_once`/`reconcile_once` are `pub` and take explicit time params so the ITs (Task 8) drive them directly without the lease/loop.

**Files:**
- Create: `crates/evaluator/src/maintenance.rs`
- Modify: `crates/evaluator/src/lib.rs` (add `pub mod maintenance;`)

- [ ] **Step 1: Declare the module**

At the top of `crates/evaluator/src/lib.rs`, add (after the `use` block, before `run_evaluator`):

```rust
pub mod maintenance;
```

- [ ] **Step 2: Write the module**

Create `crates/evaluator/src/maintenance.rs`:

```rust
use cc_domain::event::{Event, EventStatus};
use cc_domain::instance::{InstanceState, Status};
use cc_queue::EventBus;
use cc_stores::{PgStore, RedisLease};
use std::time::Duration as StdDuration;
use time::{Duration, OffsetDateTime};

/// Grace window before the relay re-publishes an unpublished outbox row.
pub const OUTBOX_GRACE: Duration = Duration::seconds(5);
/// Retention for expired silences before GC removes them.
pub const SILENCE_RETENTION: Duration = Duration::hours(24);
/// Multiplier on the rule interval that defines staleness.
const STALE_INTERVAL_MULTIPLE: i64 = 4;
/// Floor on the staleness threshold (seconds), so fast rules don't false-resolve.
const STALE_FLOOR_SECS: i64 = 60;

/// Staleness threshold in seconds: max(4 * interval, 60). MUST mirror the SQL formula
/// GREATEST(4 * interval_secs, 60) in `PgStore::list_stale_instances`.
pub fn staleness_threshold_secs(interval_secs: u32) -> i64 {
    (STALE_INTERVAL_MULTIPLE * interval_secs as i64).max(STALE_FLOOR_SECS)
}

/// True if an instance last evaluated at `last_seen` is stale as of `now`.
pub fn is_stale(interval_secs: u32, last_seen: Option<OffsetDateTime>, now: OffsetDateTime) -> bool {
    match last_seen {
        None => false, // mirrors SQL: NULL last_seen never satisfies `<`
        Some(ls) => now - ls >= Duration::seconds(staleness_threshold_secs(interval_secs)),
    }
}

/// Re-publish outbox rows older than `cutoff`, deleting each on success. Returns how
/// many were republished.
pub async fn relay_once(
    store: &PgStore,
    bus: &dyn EventBus,
    cutoff: OffsetDateTime,
    batch: i64,
) -> anyhow::Result<usize> {
    let claimed = store.claim_outbox(cutoff, batch).await?;
    let mut republished = 0;
    for (id, ev) in claimed {
        match bus.publish(&ev).await {
            Ok(()) => {
                store.delete_outbox(id).await?;
                republished += 1;
            }
            Err(e) => {
                tracing::warn!(error = %e, "relay publish failed; will retry next tick");
            }
        }
    }
    Ok(republished)
}

/// Auto-resolve stale instances as of `now`. Stale firing -> synthetic Resolved event
/// (written through the outbox, published, deleted) + reset to Inactive. Stale pending
/// -> reset to Inactive silently. Returns how many instances were reconciled.
pub async fn reconcile_once(
    store: &PgStore,
    bus: &dyn EventBus,
    now: OffsetDateTime,
) -> anyhow::Result<usize> {
    let stale = store.list_stale_instances(now).await?;
    let mut count = 0;
    for s in stale {
        let next = InstanceState {
            key: s.key.clone(),
            rule: s.rule,
            tenant: s.tenant,
            status: Status::Inactive,
            labels: s.labels.clone(),
            value: s.value,
            active_since: None,
            last_seen: Some(now),
            absent_count: 0,
        };
        match s.status {
            Status::Firing => {
                let ev = Event::new(
                    s.tenant,
                    s.rule,
                    s.key.clone(),
                    EventStatus::Resolved,
                    s.labels.clone(),
                    s.value,
                    s.severity,
                    s.annotations.clone(),
                    now,
                );
                let id = store.upsert_instance_with_outbox(&next, &ev).await?;
                match bus.publish(&ev).await {
                    Ok(()) => {
                        if let Err(e) = store.delete_outbox(id).await {
                            tracing::warn!(error = %e, "reconcile outbox delete failed; relay will re-publish");
                        }
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "reconcile publish failed; relay will recover");
                    }
                }
            }
            _ => {
                // Pending (or defensively anything else): never fired, nothing to resolve.
                store.upsert_instance(&next).await?;
            }
        }
        count += 1;
    }
    Ok(count)
}

/// Lease-singleton maintenance loop: relay + reconciliation every tick, silence GC
/// hourly. Mirrors `run_scheduler`'s lease + watch-shutdown pattern.
pub async fn run_maintenance(
    store: PgStore,
    bus: std::sync::Arc<dyn EventBus>,
    lease: RedisLease,
    tick: StdDuration,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    // Run GC roughly hourly regardless of tick.
    let gc_every: u64 = (3600.0 / tick.as_secs_f64()).ceil() as u64;
    let mut ticks: u64 = 0;
    loop {
        if *shutdown.borrow() {
            break;
        }
        match lease.acquire_or_refresh().await {
            Ok(true) => {
                let now = OffsetDateTime::now_utc();
                if let Err(e) = relay_once(&store, bus.as_ref(), now - OUTBOX_GRACE, 256).await {
                    tracing::error!(error = %e, "outbox relay failed");
                }
                if let Err(e) = reconcile_once(&store, bus.as_ref(), now).await {
                    tracing::error!(error = %e, "reconciliation failed");
                }
                if ticks % gc_every == 0 {
                    match store.gc_silences(now - SILENCE_RETENTION).await {
                        Ok(n) if n > 0 => tracing::info!(removed = n, "expired silences GC'd"),
                        Ok(_) => {}
                        Err(e) => tracing::error!(error = %e, "silence GC failed"),
                    }
                }
                ticks = ticks.wrapping_add(1);
            }
            Ok(false) => tracing::debug!("maintenance standby (lease held elsewhere)"),
            Err(e) => tracing::error!(error = %e, "lease error"),
        }
        tokio::select! {
            _ = tokio::time::sleep(tick) => {}
            _ = shutdown.changed() => {}
        }
    }
    tracing::info!("maintenance stopped");
}
```

- [ ] **Step 3: Add unit tests for the pure predicate**

Append to `crates/evaluator/src/maintenance.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_is_four_intervals_with_floor() {
        assert_eq!(staleness_threshold_secs(30), 120); // 4*30
        assert_eq!(staleness_threshold_secs(5), 60); // floor
        assert_eq!(staleness_threshold_secs(0), 60); // floor
        assert_eq!(staleness_threshold_secs(3600), 14400); // 4*3600
    }

    #[test]
    fn is_stale_boundary() {
        let now = OffsetDateTime::UNIX_EPOCH + Duration::seconds(10_000);
        // interval 30 -> threshold 120s.
        assert!(!is_stale(30, Some(now - Duration::seconds(119)), now));
        assert!(is_stale(30, Some(now - Duration::seconds(120)), now));
        assert!(is_stale(30, Some(now - Duration::seconds(300)), now));
        assert!(!is_stale(30, None, now));
    }
}
```

- [ ] **Step 4: Run unit tests + build**

Run: `cargo test -p cc-evaluator --lib`
Expected: PASS (the `maintenance::tests` unit tests; no Docker needed).

Run: `cargo build -p cc-evaluator`
Expected: compiles. (`cc-evaluator` already depends on `cc-stores`, `cc-queue`, `cc-domain`, `tokio`, `time`, `tracing`, `anyhow` — no Cargo.toml change needed. `RedisLease` is re-exported from `cc-stores`.)

- [ ] **Step 5: Clippy + commit**

Run: `cargo clippy -p cc-evaluator --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/evaluator/src/lib.rs crates/evaluator/src/maintenance.rs
git commit -m "Add maintenance loop: outbox relay, reconciliation, silence GC"
```

---

### Task 8: Maintenance integration tests (relay + reconciliation)

Drive `relay_once` and `reconcile_once` against real Postgres + Redis.

**Files:**
- Test: `crates/evaluator/tests/maintenance_it.rs`

- [ ] **Step 1: Confirm test deps**

`crates/evaluator/Cargo.toml` needs dev-deps for the ITs: `testcontainers-modules` (postgres + redis features), `cc-queue`, `cc-stores`, `cc-domain`, `tokio`, `time`, `uuid`, `serde_json`. Add a `[dev-dependencies]` section if absent, mirroring `crates/dispatcher/Cargo.toml`'s dev-deps (the dispatcher already has Postgres+Redis ITs — copy its `[dev-dependencies]` block and the testcontainers feature flags verbatim). For example:

```toml
[dev-dependencies]
testcontainers-modules = { workspace = true, features = ["postgres", "redis"] }
uuid = { workspace = true }
```

(Only add entries not already present. `cc-queue`/`cc-stores`/`cc-domain`/`tokio`/`time`/`serde_json` are already normal deps and are usable in tests.)

- [ ] **Step 2: Write the ITs**

Create `crates/evaluator/tests/maintenance_it.rs`:

```rust
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, TenantId};
use cc_domain::instance::{InstanceState, Status};
use cc_domain::rule::{RuleSpec, Severity};
use cc_evaluator::maintenance::{reconcile_once, relay_once};
use cc_queue::event_bus::RedisEventBus;
use cc_queue::EventBus;
use cc_stores::PgStore;
use std::collections::BTreeMap;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

fn spec(interval_secs: u32) -> RuleSpec {
    RuleSpec {
        sql: "SELECT 1".into(),
        interval_secs,
        for_secs: 0,
        label_columns: vec![],
        value_column: None,
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        resolve_after: 1,
    }
}

fn instance(rule: cc_domain::ids::RuleId, tenant: TenantId, name: &str, status: Status, last_seen: OffsetDateTime) -> InstanceState {
    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), name.to_string());
    let key = InstanceKey::new(rule, &labels);
    let mut s = InstanceState::new_inactive(key, rule, tenant, labels);
    s.status = status;
    s.last_seen = Some(last_seen);
    s.active_since = Some(last_seen);
    s
}

#[tokio::test]
async fn relay_publishes_stale_outbox_rows_and_deletes_them() {
    let pg = Postgres::default().start().await.unwrap();
    let pg_url = format!("postgres://postgres:postgres@127.0.0.1:{}/postgres", pg.get_host_port_ipv4(5432).await.unwrap());
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!("redis://127.0.0.1:{}", redis.get_host_port_ipv4(6379).await.unwrap());

    let store = PgStore::connect(&pg_url).await.unwrap();
    store.migrate().await.unwrap();
    let bus = RedisEventBus::connect(&redis_url).await.unwrap();

    let tenant = TenantId(Uuid::new_v4());
    let rule = store.create_rule(tenant, &spec(30)).await.unwrap();
    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), "api".to_string());
    let key = InstanceKey::new(rule.id, &labels);
    let mut inst = InstanceState::new_inactive(key.clone(), rule.id, tenant, labels.clone());
    inst.status = Status::Firing;
    let ev = Event::new(tenant, rule.id, key, EventStatus::Firing, labels, None, Severity::Critical, BTreeMap::new(), OffsetDateTime::UNIX_EPOCH);

    // Create an outbox row (simulating a publish that never happened).
    store.upsert_instance_with_outbox(&inst, &ev).await.unwrap();

    // Relay with a future cutoff claims it, publishes, deletes.
    let n = relay_once(&store, &bus, OffsetDateTime::now_utc() + Duration::hours(1), 256).await.unwrap();
    assert_eq!(n, 1);

    // Outbox is now empty.
    let remaining = store.claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 256).await.unwrap();
    assert!(remaining.is_empty());

    // The event reached the stream.
    let got = bus.consume("relay-test", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].event.status, EventStatus::Firing);
}

#[tokio::test]
async fn reconcile_resolves_stale_firing_and_clears_pending() {
    let pg = Postgres::default().start().await.unwrap();
    let pg_url = format!("postgres://postgres:postgres@127.0.0.1:{}/postgres", pg.get_host_port_ipv4(5432).await.unwrap());
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!("redis://127.0.0.1:{}", redis.get_host_port_ipv4(6379).await.unwrap());

    let store = PgStore::connect(&pg_url).await.unwrap();
    store.migrate().await.unwrap();
    let bus = RedisEventBus::connect(&redis_url).await.unwrap();

    let tenant = TenantId(Uuid::new_v4());
    let rule = store.create_rule(tenant, &spec(30)).await.unwrap(); // threshold 120s
    let now = OffsetDateTime::now_utc();

    store.upsert_instance(&instance(rule.id, tenant, "stale-fire", Status::Firing, now - Duration::seconds(300))).await.unwrap();
    store.upsert_instance(&instance(rule.id, tenant, "stale-pend", Status::Pending, now - Duration::seconds(300))).await.unwrap();
    store.upsert_instance(&instance(rule.id, tenant, "fresh-fire", Status::Firing, now - Duration::seconds(10))).await.unwrap();

    let n = reconcile_once(&store, &bus, now).await.unwrap();
    assert_eq!(n, 2, "two stale instances reconciled");

    // Both stale instances are now Inactive; fresh one untouched.
    let loaded = store.load_instances(rule.id).await.unwrap();
    let by_name = |name: &str| loaded.iter().find(|i| i.labels.get("service").map(|s| s == name).unwrap_or(false)).unwrap().status;
    assert_eq!(by_name("stale-fire"), Status::Inactive);
    assert_eq!(by_name("stale-pend"), Status::Inactive);
    assert_eq!(by_name("fresh-fire"), Status::Firing);

    // Exactly one Resolved event was published (for the stale firing; pending emits none).
    let got = bus.consume("reconcile-test", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].event.status, EventStatus::Resolved);
    assert_eq!(got[0].event.labels.get("service").unwrap(), "stale-fire");

    // The reconcile outbox row was deleted after publish.
    let remaining = store.claim_outbox(OffsetDateTime::now_utc() + Duration::hours(1), 256).await.unwrap();
    assert!(remaining.is_empty());
}
```

- [ ] **Step 3: Run the ITs**

Run: `cargo test -p cc-evaluator --test maintenance_it`
Expected: PASS (Docker Postgres + Redis). `RedisEventBus::connect` creates the consumer group at `$`, so `consume` after publish sees the new entries.

- [ ] **Step 4: Clippy + commit**

Run: `cargo clippy -p cc-evaluator --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/evaluator/Cargo.toml crates/evaluator/tests/maintenance_it.rs
git commit -m "Add maintenance integration tests (relay + reconciliation)"
```

---

### Task 9: Wire `run_maintenance` into `main.rs` + end-to-end durability test

Spawn the loop under the evaluator role on its own lease, and prove the full pipeline recovers a dropped inline publish.

**Files:**
- Modify: `src/main.rs`
- Test: `tests/e2e_durability.rs`

- [ ] **Step 1: Add the import**

In `src/main.rs`, the `use cc_evaluator::run_evaluator;` line becomes:

```rust
use cc_evaluator::{run_evaluator, maintenance::run_maintenance};
```

- [ ] **Step 2: Spawn the maintenance loop in the evaluator block**

In `src/main.rs`, inside `if run("evaluator") { ... }`, after the existing `run_evaluator` spawn, add a second spawn that acquires its own lease and runs the maintenance loop:

```rust
        {
            let lease = RedisLease::connect(
                &cfg.redis_url,
                "cc:maintenance:lease",
                &cfg.node_id,
                10_000,
            )
            .await?;
            let store = store.clone();
            let bus = event_bus.clone();
            let rx = sd_rx.clone();
            handles.push(tokio::spawn(async move {
                run_maintenance(store, bus, lease, Duration::from_secs(5), rx).await;
            }));
        }
```

`RedisLease` is already imported in `main.rs` (`use cc_stores::{PgStore, RedisLease};`). `Duration` (`std::time::Duration`) is already imported.

- [ ] **Step 3: Build**

Run: `cargo build`
Expected: compiles.

- [ ] **Step 4: Write the e2e test**

Create `tests/e2e_durability.rs`. It wraps the `EventBus` so the FIRST `publish` call (the evaluator's inline publish) fails; all later calls (the relay's) delegate to the real Redis bus. The relay must then deliver the dropped event end-to-end.

```rust
use async_trait::async_trait;
use cc_clickhouse::ChClient;
use cc_dispatcher::cache::FilterCache;
use cc_dispatcher::notify::WebhookNotifier;
use cc_dispatcher::{run_dispatcher, Notifiers};
use cc_domain::ids::TenantId;
use cc_domain::rule::{RuleSpec, Severity};
use cc_domain::Event;
use cc_evaluator::maintenance::run_maintenance;
use cc_evaluator::run_evaluator;
use cc_queue::event_bus::RedisEventBus;
use cc_queue::groups::{GroupStore, RedisGroups};
use cc_queue::redis_streams::RedisQueue;
use cc_queue::{EvalJob, EventBus, EventEntry, Queue, QueueError};
use cc_stores::{PgStore, RedisLease};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

type Captured = Arc<Mutex<Vec<serde_json::Value>>>;

/// EventBus wrapper whose FIRST publish fails (simulating the evaluator's inline publish
/// being lost), then delegates to the real bus. Everything else delegates.
struct FlakyBus {
    inner: RedisEventBus,
    failed_once: AtomicBool,
}

#[async_trait]
impl EventBus for FlakyBus {
    async fn publish(&self, ev: &Event) -> Result<(), QueueError> {
        if !self.failed_once.swap(true, Ordering::SeqCst) {
            return Err(QueueError::Json(serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "simulated inline publish failure",
            ))));
        }
        self.inner.publish(ev).await
    }
    async fn consume(&self, c: &str, n: usize, b: usize) -> Result<Vec<EventEntry>, QueueError> {
        self.inner.consume(c, n, b).await
    }
    async fn ack(&self, id: &str) -> Result<(), QueueError> {
        self.inner.ack(id).await
    }
    async fn tail(&self, last: &str, n: usize, b: usize) -> Result<Vec<EventEntry>, QueueError> {
        self.inner.tail(last, n, b).await
    }
    async fn dead_letter(&self, ev: &Event, reason: &str) -> Result<(), QueueError> {
        self.inner.dead_letter(ev, reason).await
    }
}

async fn stub_clickhouse() -> String {
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route("/", post(|| async { "{\"service\":\"api\",\"n\":5}\n".to_string() }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok(); });
    format!("http://{addr}/")
}

async fn stub_webhook(captured: Captured) -> String {
    use axum::routing::post;
    use axum::{Json, Router};
    let app = Router::new().route(
        "/hook",
        post(move |Json(body): Json<serde_json::Value>| {
            let captured = captured.clone();
            async move {
                captured.lock().unwrap().push(body);
                "ok"
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok(); });
    format!("http://{addr}/hook")
}

#[tokio::test]
async fn relay_recovers_dropped_inline_publish() {
    let pg = Postgres::default().start().await.unwrap();
    let pg_url = format!("postgres://postgres:postgres@127.0.0.1:{}/postgres", pg.get_host_port_ipv4(5432).await.unwrap());
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!("redis://127.0.0.1:{}", redis.get_host_port_ipv4(6379).await.unwrap());

    let store = PgStore::connect(&pg_url).await.unwrap();
    store.migrate().await.unwrap();
    let queue: Arc<dyn Queue> = Arc::new(RedisQueue::connect(&redis_url).await.unwrap());
    let bus: Arc<dyn EventBus> = Arc::new(FlakyBus {
        inner: RedisEventBus::connect(&redis_url).await.unwrap(),
        failed_once: AtomicBool::new(false),
    });

    let ch = ChClient::new(stub_clickhouse().await, "default", "");
    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    let tenant = TenantId(Uuid::new_v4());
    store.create_subscription(tenant, &hook).await.unwrap();
    let spec = RuleSpec {
        sql: "SELECT service, count() AS n FROM spans GROUP BY service".into(),
        interval_secs: 1,
        for_secs: 0,
        label_columns: vec!["service".into()],
        value_column: Some("n".into()),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
    };
    let rule = store.create_rule(tenant, &spec).await.unwrap();

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);

    let ev_handle = {
        let (store, queue, bus, rx) = (store.clone(), queue.clone(), bus.clone(), sd_rx.clone());
        tokio::spawn(async move { run_evaluator("e1".into(), store, queue, ch, bus, rx).await; })
    };

    // Maintenance loop with a short tick so the relay fires quickly.
    let maint_handle = {
        let lease = RedisLease::connect(&redis_url, "cc:maintenance:lease", "m1", 10_000).await.unwrap();
        let (store, bus, rx) = (store.clone(), bus.clone(), sd_rx.clone());
        tokio::spawn(async move { run_maintenance(store, bus, lease, Duration::from_millis(200), rx).await; })
    };

    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());
    let cache = Arc::new(FilterCache::new(store.clone()));
    let disp_handle = {
        let mut reg = Notifiers::new();
        reg.register(Arc::new(WebhookNotifier::new()));
        let notifiers = Arc::new(reg);
        let (store, bus, groups, cache, rx) = (store.clone(), bus.clone(), groups.clone(), cache.clone(), sd_rx.clone());
        tokio::spawn(async move { run_dispatcher("d1".into(), store, bus, notifiers, groups, cache, rx).await; })
    };

    queue.enqueue(&EvalJob { tenant, rule: rule.id, eval_ts: OffsetDateTime::now_utc() }).await.unwrap();

    // The inline publish fails (FlakyBus first call); the relay re-publishes within a
    // few ticks. Wait up to ~10s for exactly one delivery.
    for _ in 0..100 {
        if !captured.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    {
        let got = captured.lock().unwrap();
        assert_eq!(got.len(), 1, "relay recovered exactly one delivery");
        assert_eq!(got[0]["events"][0]["status"], "firing");
        assert_eq!(got[0]["events"][0]["labels"]["service"], "api");
    }

    let _ = sd_tx.send(true);
    let _ = ev_handle.await;
    let _ = maint_handle.await;
    let _ = disp_handle.await;
}
```

Notes for the implementer:
- `QueueError` variants are `Redis(..)` and `Json(..)` (see `crates/queue/src/lib.rs`). The test fabricates a `Json` error to simulate failure. If `serde_json::Error::io` is not constructible that way, use any other simple way to produce a `QueueError` (e.g. add a `#[from] std::io::Error` is NOT present — so instead trigger a `Json` error via `serde_json::from_str::<i32>("x").unwrap_err().into()`). Pick whatever compiles; the only requirement is the first `publish` returns `Err`.
- Mirrors `tests/e2e_dispatch.rs` exactly except for the `FlakyBus` wrapper and the maintenance spawn.

- [ ] **Step 5: Run the e2e**

Run: `cargo test --test e2e_durability`
Expected: PASS — one webhook delivery, recovered by the relay after the inline publish failed.

- [ ] **Step 6: Clippy + commit**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: clean.

```bash
git add src/main.rs tests/e2e_durability.rs
git commit -m "Wire run_maintenance into main; add e2e durability recovery test"
```

---

### Task 10: Full-workspace verification

**Files:** none (verification only).

- [ ] **Step 1: Clippy across the workspace**

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 2: Full test suite (the real gate)**

Run: `cargo test --workspace --no-fail-fast`
Expected: all green — engine/domain unit tests, `outbox_it`, `reconcile_it`, `maintenance_it`, existing store/dispatcher/api ITs, and all e2e (`e2e_dispatch`, `e2e_routing`, `e2e_grouping`, `e2e_silences_inhibition`, `e2e_durability`). Docker must be running.

- [ ] **Step 3: Format**

Run: `cargo fmt --all && git diff --stat`
Expected: no changes (or commit formatting if any).

If fmt changed files:

```bash
git add -A
git commit -m "cargo fmt"
```

---

## Self-Review

**1. Spec coverage:**
- Outbox table → Task 3. ✓
- `upsert_instance_with_outbox` / `claim_outbox` / `delete_outbox` → Task 4. ✓
- `list_stale_instances` (JOIN + `GREATEST(4×interval,60)`) / `gc_silences` → Task 5. ✓
- Evaluator atomic write + delete-on-publish → Task 6. ✓
- Maintenance loop (relay ~5s, reconciliation ~5s, silence GC hourly) → Task 7. ✓
- Shared Resolved-event constructor (anti-drift) → Task 1. ✓
- `main.rs` wiring on `cc:maintenance:lease` → Task 9. ✓
- Publish-then-relay; self-cleaning outbox (delete on publish) → Tasks 6, 7. ✓
- Tests: unit (is_stale/threshold, Event::new), store ITs (outbox incl. forced rollback + grace; stale + gc), relay IT, reconciliation IT, e2e recovery → Tasks 1,4,5,8,9. ✓
- Backward compatibility (empty outbox/no-stale = no-ops; `run_evaluator` signature unchanged) → confirmed in Task 6 (existing e2e still pass). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**3. Type consistency:** `Event::new` arg order is identical in Task 1, Task 7 (`reconcile_once`), and test usages. `StaleInstance` fields defined in Task 2 match their reads in Task 5 and writes in Task 7. `claim_outbox(cutoff, batch)`, `relay_once(store, bus, cutoff, batch)`, `reconcile_once(store, bus, now)`, `gc_silences(cutoff)` signatures match across definition and all call sites/tests. `run_maintenance(store, bus, lease, tick, shutdown)` matches the `main.rs` and e2e spawns. ✓

**Implementer caveat:** two spots require matching existing code exactly rather than guessing — the `absent_count` bind expression in `upsert_instance_with_outbox` (copy from `upsert_instance`) and the `Matcher`/`MatchOp` construction in `reconcile_it.rs` (copy from a 3A test). Both are flagged inline.
