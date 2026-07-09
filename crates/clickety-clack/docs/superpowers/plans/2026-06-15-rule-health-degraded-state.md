# Rule Health & Degraded-State Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface repeatedly-failing rule evaluation queries as routable, silenceable, debounced rule-health notifications, and guarantee a degraded rule's frozen alert instances are never falsely resolved.

**Architecture:** Reuse the existing single-`Event` dispatch pipeline. Add a typed `EventKind { Alert, RuleHealth }` discriminator (projected into a `kind` routing label) instead of a parallel event type. Health state lives as columns on `rules`; the evaluator's query-error/success branches drive per-rule failure counters and emit `RuleHealth` events (Firing=degraded, Resolved=recovered) through the existing outbox/exactly-once path. A one-line guard on the stale-instance reaper protects degraded rules.

**Tech Stack:** Rust, sqlx/Postgres, axum, reqwest, the `time` crate. See `docs/superpowers/specs/2026-06-15-rule-health-degraded-state-design.md`.

**Environment note for the controller:** Subagents' Bash is sandboxed from `cargo`. Subagents make edits and write tests; the controller compiles, runs `cargo test`/`clippy`/`fmt`, and commits. Run integration crates (`-p cc-stores`, `-p cc-evaluator`, `-p cc-api`) **one at a time** — running them together causes testcontainer startup contention and false failures.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `crates/domain/src/event.rs` | `EventKind`, `Event.kind`, `Event::rule_health` constructor | 1 |
| `crates/domain/src/ids.rs` | `InstanceKey::health(rule)` | 1 |
| `crates/domain/src/rule.rs` | `RuleHealth` representation type | 2 |
| `migrations/0001_init.sql` | health columns on `rules` (edited in place) | 3 |
| `crates/clickhouse/src/lib.rs` | `ChError` URL-scrubbing | 4 |
| `crates/stores/src/pg.rs` | reaper guard; `record_rule_failure`/`record_rule_success`; `get_rule_with_health`/`list_rules` | 5,6,7,8 |
| `src/config.rs` | `CC_RULE_DEGRADE_AFTER` | 9 |
| `crates/evaluator/src/lib.rs` + `src/main.rs` | wire health branches, cap error, thread threshold | 10 |
| `crates/dispatcher/src/routing.rs` | `kind` synthetic label | 11 |
| `crates/dispatcher/src/render.rs` (new) + `email.rs`/`slack.rs`/`pagerduty.rs` | `kind`-aware headline/status | 12 |
| `crates/api/src/rules.rs` | `health` on rule GET; minimal list + `?health=` filter | 13 |
| `docs/` | how-to, explanation, config reference | 14 |

---

### Task 1: Domain — `EventKind`, `Event.kind`, health constructors

**Files:**
- Modify: `crates/domain/src/event.rs`
- Modify: `crates/domain/src/ids.rs`
- Modify (add `kind` field to `Event { ... }` literals): `crates/dispatcher/src/notify.rs`, `grouping.rs`, `pagerduty.rs`, `slack.rs`, `retry.rs`, `routing.rs`

- [ ] **Step 1: Write the failing test (event.rs)**

Add to the `tests` module in `crates/domain/src/event.rs`:

```rust
#[test]
fn event_kind_serde_roundtrip() {
    assert_eq!(
        serde_json::to_string(&EventKind::RuleHealth).unwrap(),
        "\"rule_health\""
    );
    assert_eq!(
        serde_json::from_str::<EventKind>("\"alert\"").unwrap(),
        EventKind::Alert
    );
}

#[test]
fn rule_health_constructor_sets_kind_and_reserved_key() {
    use crate::ids::RuleId;
    use uuid::Uuid;
    let rule = RuleId(Uuid::nil());
    let ev = Event::rule_health(
        TenantId::from_trusted(Uuid::nil().to_string()),
        rule,
        EventStatus::Firing,
        BTreeMap::new(),
        OffsetDateTime::UNIX_EPOCH,
    );
    assert_eq!(ev.kind, EventKind::RuleHealth);
    assert_eq!(ev.severity, Severity::Critical);
    assert_eq!(ev.instance_key, InstanceKey::health(rule));
    assert!(ev.labels.is_empty());
}
```

Add `use crate::ids::InstanceKey;` and `use crate::rule::Severity;` to the test module if not already imported (the existing module imports `InstanceKey, RuleId, TenantId`; add `Severity`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-domain event_kind_serde_roundtrip rule_health_constructor`
Expected: FAIL — `EventKind` / `Event::rule_health` not found.

- [ ] **Step 3: Implement `EventKind` and the field**

In `crates/domain/src/event.rs`, add after the `EventStatus` enum:

```rust
/// Discriminates an operational rule-health notification from a data alert. Projected
/// into a `kind` routing label so operators route/silence health with normal matchers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    #[default]
    Alert,
    RuleHealth,
}
```

Add the field to `Event` (place it right after `pub status: EventStatus,`):

```rust
    pub kind: EventKind,
```

In `Event::new`, set `kind: EventKind::Alert,` in the returned struct literal (keeps all existing `Event::new` callers unchanged — they produce data alerts).

Add the health constructor in the `impl Event` block:

```rust
    /// Build a rule-health event. Severity is fixed `Critical` (a blind rule is oncall-worthy
    /// regardless of its own severity); the instance key is the reserved per-rule health key,
    /// so degrade (`Firing`) and recover (`Resolved`) pair under dedup.
    pub fn rule_health(
        tenant: TenantId,
        rule: RuleId,
        status: EventStatus,
        annotations: BTreeMap<String, String>,
        eval_ts: OffsetDateTime,
    ) -> Self {
        Self {
            tenant,
            rule,
            instance_key: InstanceKey::health(rule),
            status,
            kind: EventKind::RuleHealth,
            labels: BTreeMap::new(),
            value: None,
            severity: crate::rule::Severity::Critical,
            annotations,
            eval_ts,
        }
    }
```

Ensure the file imports `InstanceKey` (the top already imports `use crate::ids::{InstanceKey, RuleId, TenantId};` — confirm `InstanceKey` is present; add it if not).

- [ ] **Step 4: Implement `InstanceKey::health` (ids.rs)**

In `crates/domain/src/ids.rs`, add to the `impl InstanceKey` block:

```rust
    /// Reserved, deterministic per-rule key for rule-health events. Uses a `__cc_`-prefixed
    /// label name the SQL label path cannot produce, so it never collides with a data instance.
    pub fn health(rule_id: RuleId) -> Self {
        let mut m = std::collections::BTreeMap::new();
        m.insert("__cc_health".to_string(), "1".to_string());
        InstanceKey::new(rule_id, &m)
    }
```

- [ ] **Step 5: Add `kind` to all `Event { ... }` struct literals**

Each of these constructs an `Event` with a struct literal and must add `kind: cc_domain::EventKind::Alert,` (or `EventKind::Alert` if already imported). Add it next to the `status:` field:

- `crates/dispatcher/src/notify.rs:108` (test helper `ev`)
- `crates/dispatcher/src/grouping.rs:120` (test helper `ev`)
- `crates/dispatcher/src/pagerduty.rs:112` (test helper `ev`)
- `crates/dispatcher/src/slack.rs:115` and `:136` (test helpers)
- `crates/dispatcher/src/retry.rs:49` (test)
- `crates/dispatcher/src/routing.rs:127` (test helper `ev`)

For each file, add `use cc_domain::EventKind;` to the test module imports (or use the fully-qualified `cc_domain::EventKind::Alert`).

- [ ] **Step 6: Add health InstanceKey distinctness test (ids.rs)**

Add to the `tests` module in `crates/domain/src/ids.rs`:

```rust
#[test]
fn health_key_is_deterministic_and_distinct() {
    use uuid::Uuid;
    let rule = RuleId(Uuid::nil());
    assert_eq!(InstanceKey::health(rule), InstanceKey::health(rule));
    // Distinct from a data instance with no labels for the same rule.
    assert_ne!(
        InstanceKey::health(rule),
        InstanceKey::new(rule, &std::collections::BTreeMap::new())
    );
}
```

- [ ] **Step 7: Run tests**

Run: `cargo test -p cc-domain` then `cargo build -p cc-dispatcher`
Expected: PASS; dispatcher compiles with the new field.

- [ ] **Step 8: Commit**

```bash
git add crates/domain/src/event.rs crates/domain/src/ids.rs crates/dispatcher/src/
git commit -m "Add EventKind discriminator and rule-health event constructor"
```

---

### Task 2: Domain — `RuleHealth` representation

**Files:**
- Modify: `crates/domain/src/rule.rs`

- [ ] **Step 1: Write the failing test**

Add to a `tests` module in `crates/domain/src/rule.rs`:

```rust
#[test]
fn rule_health_serializes_expected_shape() {
    let h = RuleHealth {
        status: "degraded".into(),
        consecutive_failures: 5,
        degraded_since: Some(time::OffsetDateTime::UNIX_EPOCH),
        last_error: Some("boom".into()),
        last_error_at: Some(time::OffsetDateTime::UNIX_EPOCH),
    };
    let v = serde_json::to_value(&h).unwrap();
    assert_eq!(v["status"], "degraded");
    assert_eq!(v["consecutive_failures"], 5);
    assert_eq!(v["last_error"], "boom");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-domain rule_health_serializes`
Expected: FAIL — `RuleHealth` not found.

- [ ] **Step 3: Implement `RuleHealth`**

Add to `crates/domain/src/rule.rs`:

```rust
/// Operational health of a rule, a separate axis from the per-instance state machine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuleHealth {
    /// `"healthy"` or `"degraded"`.
    pub status: String,
    pub consecutive_failures: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub degraded_since: Option<time::OffsetDateTime>,
    pub last_error: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_error_at: Option<time::OffsetDateTime>,
}
```

(`time` with the `serde-well-known` feature is already used by `event.rs`'s `time::serde::rfc3339`, so `::option` is available.)

- [ ] **Step 4: Run test**

Run: `cargo test -p cc-domain rule_health_serializes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/domain/src/rule.rs
git commit -m "Add RuleHealth representation type"
```

---

### Task 3: Migration — health columns on `rules`

**Files:**
- Modify: `migrations/0001_init.sql`

- [ ] **Step 1: Edit the `rules` table in place**

In `migrations/0001_init.sql`, the `CREATE TABLE rules (...)` block currently ends with `created_at` / `updated_at`. Add four columns before `created_at`:

```sql
CREATE TABLE rules (
    id          UUID PRIMARY KEY,
    tenant      TEXT NOT NULL,
    spec        JSONB NOT NULL,
    version     BIGINT NOT NULL DEFAULT 1,
    next_eval   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_eval   TIMESTAMPTZ,
    last_error  TEXT,
    health_status        TEXT NOT NULL DEFAULT 'healthy',
    consecutive_failures INT  NOT NULL DEFAULT 0,
    degraded_since       TIMESTAMPTZ,
    last_error_at        TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Verify the migration is well-formed**

Run: `cargo build -p cc-stores`
Expected: compiles (sqlx is not compile-time-checked here; this just confirms no syntax breakage in surrounding Rust). The migration is exercised by the Task 5–8 testcontainer tests.

- [ ] **Step 3: Commit**

```bash
git add migrations/0001_init.sql
git commit -m "Add rule-health columns to the rules table"
```

---

### Task 4: ClickHouse — scrub credentials from `ChError`

**Files:**
- Modify: `crates/clickhouse/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Add a test module to `crates/clickhouse/src/lib.rs` (or extend an existing one):

```rust
#[cfg(test)]
mod error_scrub_tests {
    use super::*;

    #[tokio::test]
    async fn transport_error_string_excludes_url_and_creds() {
        // Point at a closed port with credentials embedded in the URL.
        let auth = crate::build_ch_auth("shared", "default", "", None, None, "", None).unwrap();
        let ch = ChClient::new("http://user:supersecret@127.0.0.1:1", auth);
        let t = cc_domain::ids::TenantId::from_trusted("t".to_string());
        let err = ch
            .query_rows(&t, "SELECT 1", &[], None)
            .await
            .unwrap_err();
        let s = err.to_string();
        assert!(!s.contains("supersecret"), "leaked creds: {s}");
        assert!(!s.contains("127.0.0.1:1"), "leaked url: {s}");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-clickhouse transport_error_string_excludes_url`
Expected: FAIL — the reqwest error's `Display` includes the URL (and may include creds).

- [ ] **Step 3: Replace the `#[from]` with a URL-scrubbing conversion**

In `crates/clickhouse/src/lib.rs`, change the `ChError::Http` variant to carry a `String` and add a manual `From` that strips the URL:

```rust
#[derive(Debug, Error)]
pub enum ChError {
    #[error("http: {0}")]
    Http(String),
    #[error("clickhouse returned status {0}: {1}")]
    Status(u16, String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

impl From<reqwest::Error> for ChError {
    /// `without_url()` drops the request URL (which may embed `user:pass@host`) so a
    /// transport error can never carry credentials into a stored `last_error`.
    fn from(e: reqwest::Error) -> Self {
        ChError::Http(e.without_url().to_string())
    }
}
```

The `?` operators in `query_rows` continue to work via this `From` impl.

- [ ] **Step 4: Run test**

Run: `cargo test -p cc-clickhouse transport_error_string_excludes_url`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/clickhouse/src/lib.rs
git commit -m "Scrub request URL from ClickHouse transport errors"
```

---

### Task 5: Store — stale-reaper guard for degraded rules

**Files:**
- Modify: `crates/stores/src/pg.rs` (`list_stale_instances`)
- Test: `crates/stores/tests/` (new or existing reconcile/stale test file)

- [ ] **Step 1: Write the failing test**

Create `crates/stores/tests/rule_health_reaper_it.rs`:

```rust
//! A degraded rule's firing instances must never be listed as stale (would cause a false Resolved).
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::instance::{InstanceState, Status};
use cc_domain::rule::{RuleSpec, Severity};
use std::collections::BTreeMap;
use time::{Duration, OffsetDateTime};

mod common; // reuse the crate's existing test harness if present; otherwise inline a PgStore setup.

#[tokio::test]
async fn degraded_rule_firing_instances_are_not_stale() {
    let store = common::test_store().await; // returns a migrated PgStore against a testcontainer
    let tenant = TenantId::from_trusted("t".to_string());
    let rule = RuleId(uuid::Uuid::new_v4());
    let spec = RuleSpec {
        sql: "SELECT 1".into(), interval_secs: 30, for_secs: 0,
        label_columns: vec![], value_column: None, severity: Severity::Warning,
        annotations: BTreeMap::new(), resolve_after: 1,
    };
    store.create_rule(&rule, &tenant, &spec).await.unwrap(); // use the crate's existing insert helper

    // A firing instance whose last_seen is well past the stale threshold.
    let key = InstanceKey::new(rule, &BTreeMap::new());
    let inst = InstanceState {
        key: key.clone(), rule, tenant: tenant.clone(), status: Status::Firing,
        labels: BTreeMap::new(), value: None,
        active_since: Some(OffsetDateTime::UNIX_EPOCH),
        last_seen: Some(OffsetDateTime::UNIX_EPOCH), absent_count: 0,
    };
    store.upsert_instance(&inst).await.unwrap();

    let now = OffsetDateTime::UNIX_EPOCH + Duration::hours(1);

    // Healthy rule: instance IS stale.
    assert_eq!(store.list_stale_instances(now).await.unwrap().len(), 1);

    // Mark degraded, then it must NOT be stale.
    store.mark_degraded_for_test(rule).await.unwrap();
    assert_eq!(store.list_stale_instances(now).await.unwrap().len(), 0);
}
```

Add a `#[doc(hidden)]` test helper to `pg.rs`:

```rust
#[doc(hidden)]
pub async fn mark_degraded_for_test(&self, id: RuleId) -> Result<(), StoreError> {
    sqlx::query("UPDATE rules SET health_status='degraded', degraded_since=now() WHERE id=$1")
        .bind(id.0).execute(&self.pool).await?;
    Ok(())
}
```

> If the stores crate already has a test harness module (e.g. `tests/common/mod.rs` with `test_store()` and rule-insert helpers), use those names instead and delete the `create_rule`/`mod common` placeholders above. Inspect `crates/stores/tests/` first and match the existing pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-stores degraded_rule_firing_instances_are_not_stale`
Expected: FAIL — second assertion returns 1 (no guard yet).

- [ ] **Step 3: Add the guard**

In `list_stale_instances`, add the health predicate to the `WHERE` clause:

```sql
WHERE i.status IN ('pending','firing')
  AND NOT r.paused
  AND r.health_status <> 'degraded'
  AND i.last_seen < ($1::timestamptz
      - make_interval(secs => GREATEST(4 * (r.spec->>'interval_secs')::int, 60)))
```

- [ ] **Step 4: Run test**

Run: `cargo test -p cc-stores degraded_rule_firing_instances_are_not_stale`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/stores/src/pg.rs crates/stores/tests/rule_health_reaper_it.rs
git commit -m "Exclude degraded rules from stale-instance reaping"
```

---

### Task 6: Store — `record_rule_failure`

**Files:**
- Modify: `crates/stores/src/pg.rs`
- Test: `crates/stores/tests/rule_health_it.rs` (new)

- [ ] **Step 1: Write the failing test**

Create `crates/stores/tests/rule_health_it.rs`:

```rust
use cc_domain::event::{EventKind, EventStatus};
use cc_domain::ids::{RuleId, TenantId};
use cc_domain::rule::{RuleSpec, Severity};
use std::collections::BTreeMap;
use time::OffsetDateTime;

mod common;

fn spec() -> RuleSpec {
    RuleSpec {
        sql: "SELECT 1".into(), interval_secs: 30, for_secs: 0,
        label_columns: vec![], value_column: None, severity: Severity::Info,
        annotations: BTreeMap::new(), resolve_after: 1,
    }
}

#[tokio::test]
async fn failure_degrades_exactly_at_threshold() {
    let store = common::test_store().await;
    let tenant = TenantId::from_trusted("t".to_string());
    let rule = RuleId(uuid::Uuid::new_v4());
    store.create_rule(&rule, &tenant, &spec()).await.unwrap();
    let now = OffsetDateTime::UNIX_EPOCH;

    // Below threshold (K=3): no event.
    assert!(store.record_rule_failure(rule, &tenant, "boom", 3, now).await.unwrap().is_none());
    assert!(store.record_rule_failure(rule, &tenant, "boom", 3, now).await.unwrap().is_none());

    // Third failure crosses K -> one Firing/RuleHealth event.
    let (ev, _id) = store.record_rule_failure(rule, &tenant, "boom", 3, now).await.unwrap().unwrap();
    assert_eq!(ev.kind, EventKind::RuleHealth);
    assert_eq!(ev.status, EventStatus::Firing);
    assert_eq!(ev.severity, Severity::Critical);
    assert!(ev.annotations.get("summary").unwrap().contains("degraded"));
    assert_eq!(ev.annotations.get("last_error").unwrap(), "boom");

    // Already degraded: further failures emit nothing.
    assert!(store.record_rule_failure(rule, &tenant, "boom", 3, now).await.unwrap().is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-stores failure_degrades_exactly_at_threshold`
Expected: FAIL — `record_rule_failure` not found.

- [ ] **Step 3: Implement `record_rule_failure`**

Add to `impl PgStore` in `crates/stores/src/pg.rs` (near `record_eval_error`). Imports needed at top: `use cc_domain::event::{Event, EventStatus};` (the file already imports `Event` for the outbox; add `EventStatus` if absent).

```rust
/// Record a query failure for `rule`: bump the consecutive-failure counter and store the
/// (already-scrubbed, already-capped) error. If this crosses `threshold` from a healthy
/// state, flip to degraded and write a `RuleHealth`/`Firing` event to the outbox in the
/// same transaction. Returns the event + outbox id to publish, or `None`.
pub async fn record_rule_failure(
    &self,
    rule: RuleId,
    tenant: &TenantId,
    err: &str,
    threshold: i32,
    now: OffsetDateTime,
) -> Result<Option<(Event, Uuid)>, StoreError> {
    let mut tx = self.pool.begin().await?;
    let row = sqlx::query(
        "UPDATE rules
            SET consecutive_failures = consecutive_failures + 1,
                last_error = $2, last_error_at = now(), last_eval = now()
          WHERE id = $1
        RETURNING consecutive_failures, health_status",
    )
    .bind(rule.0)
    .bind(err)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(row) = row else {
        // Rule deleted mid-flight: nothing to do.
        tx.commit().await?;
        return Ok(None);
    };
    let failures: i32 = row.get("consecutive_failures");
    let status: String = row.get("health_status");

    if status == "healthy" && failures >= threshold {
        sqlx::query("UPDATE rules SET health_status='degraded', degraded_since=now() WHERE id=$1")
            .bind(rule.0)
            .execute(&mut *tx)
            .await?;
        let mut ann = std::collections::BTreeMap::new();
        ann.insert(
            "summary".to_string(),
            format!("Rule {} degraded after {} consecutive failures", rule.0, failures),
        );
        ann.insert("last_error".to_string(), err.to_string());
        let ev = Event::rule_health(tenant.clone(), rule, EventStatus::Firing, ann, now);
        let id = Uuid::new_v4();
        let payload = serde_json::to_value(&ev)?;
        sqlx::query("INSERT INTO event_outbox (id, tenant, payload) VALUES ($1,$2,$3)")
            .bind(id)
            .bind(tenant.as_str())
            .bind(&payload)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Ok(Some((ev, id)));
    }

    tx.commit().await?;
    Ok(None)
}
```

- [ ] **Step 4: Run test**

Run: `cargo test -p cc-stores failure_degrades_exactly_at_threshold`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/stores/src/pg.rs crates/stores/tests/rule_health_it.rs
git commit -m "Add record_rule_failure with degrade transition and outbox event"
```

---

### Task 7: Store — `record_rule_success`

**Files:**
- Modify: `crates/stores/src/pg.rs`
- Test: `crates/stores/tests/rule_health_it.rs`

- [ ] **Step 1: Write the failing test**

Append to `crates/stores/tests/rule_health_it.rs`:

```rust
#[tokio::test]
async fn success_recovers_only_if_degraded() {
    let store = common::test_store().await;
    let tenant = TenantId::from_trusted("t".to_string());
    let rule = RuleId(uuid::Uuid::new_v4());
    store.create_rule(&rule, &tenant, &spec()).await.unwrap();
    let now = OffsetDateTime::UNIX_EPOCH;

    // Healthy success -> nothing.
    assert!(store.record_rule_success(rule, &tenant, now).await.unwrap().is_none());

    // Degrade it (K=1), then a success recovers with one Resolved event.
    assert!(store.record_rule_failure(rule, &tenant, "boom", 1, now).await.unwrap().is_some());
    let (ev, _id) = store.record_rule_success(rule, &tenant, now).await.unwrap().unwrap();
    assert_eq!(ev.kind, EventKind::RuleHealth);
    assert_eq!(ev.status, EventStatus::Resolved);
    assert!(ev.annotations.get("summary").unwrap().contains("recovered"));

    // Second success: already healthy -> nothing.
    assert!(store.record_rule_success(rule, &tenant, now).await.unwrap().is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-stores success_recovers_only_if_degraded`
Expected: FAIL — `record_rule_success` not found.

- [ ] **Step 3: Implement `record_rule_success`**

Add to `impl PgStore`:

```rust
/// Record a query success for `rule`: reset the failure counter and clear the stored error.
/// If the rule was degraded, flip to healthy and write a `RuleHealth`/`Resolved` event to the
/// outbox in the same transaction. Returns the recovery event + outbox id, or `None`.
pub async fn record_rule_success(
    &self,
    rule: RuleId,
    tenant: &TenantId,
    now: OffsetDateTime,
) -> Result<Option<(Event, Uuid)>, StoreError> {
    let mut tx = self.pool.begin().await?;
    let row = sqlx::query(
        "UPDATE rules
            SET consecutive_failures = 0, last_error = NULL, last_error_at = NULL, last_eval = now()
          WHERE id = $1
        RETURNING health_status",
    )
    .bind(rule.0)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(row) = row else {
        tx.commit().await?;
        return Ok(None);
    };
    let status: String = row.get("health_status");

    if status == "degraded" {
        sqlx::query("UPDATE rules SET health_status='healthy', degraded_since=NULL WHERE id=$1")
            .bind(rule.0)
            .execute(&mut *tx)
            .await?;
        let mut ann = std::collections::BTreeMap::new();
        ann.insert("summary".to_string(), format!("Rule {} recovered", rule.0));
        let ev = Event::rule_health(tenant.clone(), rule, EventStatus::Resolved, ann, now);
        let id = Uuid::new_v4();
        let payload = serde_json::to_value(&ev)?;
        sqlx::query("INSERT INTO event_outbox (id, tenant, payload) VALUES ($1,$2,$3)")
            .bind(id)
            .bind(tenant.as_str())
            .bind(&payload)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Ok(Some((ev, id)));
    }

    tx.commit().await?;
    Ok(None)
}
```

- [ ] **Step 4: Run test**

Run: `cargo test -p cc-stores success_recovers_only_if_degraded`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/stores/src/pg.rs crates/stores/tests/rule_health_it.rs
git commit -m "Add record_rule_success with recovery transition and outbox event"
```

---

### Task 8: Store — `get_rule_with_health` and minimal `list_rules`

**Files:**
- Modify: `crates/stores/src/pg.rs`
- Test: `crates/stores/tests/rule_health_it.rs`

- [ ] **Step 1: Write the failing test**

Append to `crates/stores/tests/rule_health_it.rs`:

```rust
#[tokio::test]
async fn get_and_list_expose_health() {
    let store = common::test_store().await;
    let tenant = TenantId::from_trusted("t".to_string());
    let rule = RuleId(uuid::Uuid::new_v4());
    store.create_rule(&rule, &tenant, &spec()).await.unwrap();
    let now = OffsetDateTime::UNIX_EPOCH;

    let (_r, h) = store.get_rule_with_health(tenant.clone(), rule).await.unwrap().unwrap();
    assert_eq!(h.status, "healthy");
    assert_eq!(h.consecutive_failures, 0);

    // Degrade and confirm get + filtered list reflect it.
    store.record_rule_failure(rule, &tenant, "boom", 1, now).await.unwrap();
    let (_r, h) = store.get_rule_with_health(tenant.clone(), rule).await.unwrap().unwrap();
    assert_eq!(h.status, "degraded");
    assert_eq!(h.last_error.as_deref(), Some("boom"));

    let all = store.list_rules(&tenant, None).await.unwrap();
    assert_eq!(all.len(), 1);
    let degraded = store.list_rules(&tenant, Some("degraded")).await.unwrap();
    assert_eq!(degraded.len(), 1);
    let healthy = store.list_rules(&tenant, Some("healthy")).await.unwrap();
    assert_eq!(healthy.len(), 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-stores get_and_list_expose_health`
Expected: FAIL — methods not found.

- [ ] **Step 3: Implement both methods**

Add `use cc_domain::rule::RuleHealth;` to the imports in `pg.rs`. Add a private helper and the two methods to `impl PgStore`:

```rust
fn health_from_row(r: &sqlx::postgres::PgRow) -> RuleHealth {
    RuleHealth {
        status: r.get("health_status"),
        consecutive_failures: r.get("consecutive_failures"),
        degraded_since: r.get("degraded_since"),
        last_error: r.get("last_error"),
        last_error_at: r.get("last_error_at"),
    }
}

/// Like `get_rule`, but also returns the rule's health (for the API representation).
pub async fn get_rule_with_health(
    &self,
    tenant: TenantId,
    id: RuleId,
) -> Result<Option<(Rule, RuleHealth)>, StoreError> {
    let row = sqlx::query(
        "SELECT spec, version, paused, health_status, consecutive_failures,
                degraded_since, last_error, last_error_at
           FROM rules WHERE id=$1 AND tenant=$2",
    )
    .bind(id.0)
    .bind(tenant.as_str())
    .fetch_optional(&self.pool)
    .await?;
    match row {
        None => Ok(None),
        Some(r) => {
            let spec: RuleSpec = serde_json::from_value(r.get("spec"))?;
            let health = Self::health_from_row(&r);
            let rule = Rule { id, tenant, spec, version: r.get("version"), paused: r.get("paused") };
            Ok(Some((rule, health)))
        }
    }
}

/// Minimal (unpaginated) rule listing for a tenant, with an optional health-status filter.
/// Cursor pagination remains a separate future task; this exists so operators can find
/// degraded rules. `health` is `Some("degraded")` / `Some("healthy")` or `None` for all.
pub async fn list_rules(
    &self,
    tenant: &TenantId,
    health: Option<&str>,
) -> Result<Vec<(Rule, RuleHealth)>, StoreError> {
    let rows = sqlx::query(
        "SELECT id, spec, version, paused, health_status, consecutive_failures,
                degraded_since, last_error, last_error_at
           FROM rules
          WHERE tenant=$1 AND ($2::text IS NULL OR health_status=$2)
          ORDER BY created_at",
    )
    .bind(tenant.as_str())
    .bind(health)
    .fetch_all(&self.pool)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let spec: RuleSpec = serde_json::from_value(r.get("spec"))?;
        let health = Self::health_from_row(r);
        let rule = Rule {
            id: RuleId(r.get("id")),
            tenant: tenant.clone(),
            spec,
            version: r.get("version"),
            paused: r.get("paused"),
        };
        out.push((rule, health));
    }
    Ok(out)
}
```

(`sqlx::Row` is already in scope in `pg.rs` via existing `r.get(...)` calls. Ensure `use sqlx::Row;` and `use sqlx::postgres::PgRow;` exist — add the `PgRow` import if the helper needs it.)

- [ ] **Step 4: Run test**

Run: `cargo test -p cc-stores get_and_list_expose_health`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/stores/src/pg.rs crates/stores/tests/rule_health_it.rs
git commit -m "Add get_rule_with_health and minimal filtered list_rules"
```

---

### Task 9: Config — `CC_RULE_DEGRADE_AFTER`

**Files:**
- Modify: `src/config.rs`

- [ ] **Step 1: Write the failing test**

Add to a `tests` module in `src/config.rs` (or extend the existing one):

```rust
#[test]
fn degrade_after_defaults_to_three_and_clamps() {
    // With the var unset, from_env() must yield 3. (Run serially; env-based.)
    std::env::remove_var("CC_RULE_DEGRADE_AFTER");
    assert_eq!(Config::from_env().rule_degrade_after, 3);
    std::env::set_var("CC_RULE_DEGRADE_AFTER", "0");
    assert_eq!(Config::from_env().rule_degrade_after, 3, "0 clamps to 3");
    std::env::set_var("CC_RULE_DEGRADE_AFTER", "5");
    assert_eq!(Config::from_env().rule_degrade_after, 5);
    std::env::remove_var("CC_RULE_DEGRADE_AFTER");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc@0.1.0 degrade_after_defaults_to_three`
Expected: FAIL — `rule_degrade_after` field not found.

- [ ] **Step 3: Add the field and parse it**

In `src/config.rs`, add to the `Config` struct:

```rust
    pub rule_degrade_after: u32,
```

In `from_env`, add to the `Config { ... }` literal (mirror the `scheduler_shards` clamp idiom — a 0 threshold would degrade on the first error):

```rust
            rule_degrade_after: var("CC_RULE_DEGRADE_AFTER", "3")
                .parse()
                .ok()
                .filter(|&n| n >= 1)
                .unwrap_or(3),
```

- [ ] **Step 4: Run test**

Run: `cargo test -p cc@0.1.0 degrade_after_defaults_to_three`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.rs
git commit -m "Add CC_RULE_DEGRADE_AFTER config (default 3)"
```

---

### Task 10: Evaluator — wire health branches, cap error, thread threshold

**Files:**
- Modify: `crates/evaluator/src/lib.rs`
- Modify: `src/main.rs:120` (run_evaluator call)
- Modify: `crates/evaluator/tests/coalescing_it.rs` (call-site signature update + a new degraded/recovered test)

- [ ] **Step 1: Write the failing test**

Add to `crates/evaluator/tests/coalescing_it.rs` a test that drives the failure→degrade→recover path. The file already has a `CountingCh`/`NoopBus`-style harness and a `PgStore` testcontainer; model the new test on the existing ones. Use a ClickHouse stub that errors, then succeeds. If the existing harness can only count (not toggle errors), add a small `FlakyCh { fail: AtomicBool }` implementing `RowQuerier` whose `query_rows` returns `Err(ChError::Status(500, "boom".into()))` while `fail` is true, else `Ok(vec![])`:

```rust
#[tokio::test]
async fn repeated_query_errors_degrade_then_recover() {
    let store = common_store().await;            // existing helper in this test file
    let (rule, tenant) = seed_rule(&store).await; // existing helper: inserts a rule, returns ids
    let ch = FlakyCh::new(true);
    let bus = RecordingBus::default();            // captures published events; add if not present

    // K = 2: two failing batches degrade the rule (one RuleHealth/Firing event).
    for _ in 0..2 {
        let d = vec![delivery_for(rule, tenant.clone())]; // existing helper builds a Delivery
        cc_evaluator::process_batch(&store, &ch, &bus, 2, d).await;
    }
    assert_eq!(bus.health_firing_count(), 1);

    // Now succeed: one RuleHealth/Resolved event.
    ch.set_fail(false);
    let d = vec![delivery_for(rule, tenant.clone())];
    cc_evaluator::process_batch(&store, &ch, &bus, 2, d).await;
    assert_eq!(bus.health_resolved_count(), 1);
}
```

> Inspect `crates/evaluator/tests/coalescing_it.rs` for the actual helper names (`NoopBus`, the rule-seeding code, `Delivery` construction) and reuse them. Add `RecordingBus` only if no event-capturing bus exists; it implements `EventBus::publish` by pushing into a `Mutex<Vec<Event>>` and exposes `health_firing_count()` / `health_resolved_count()` filtering on `kind == RuleHealth` and status.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-evaluator repeated_query_errors_degrade_then_recover`
Expected: FAIL — `process_batch` arity mismatch (no `threshold` param) / no health events emitted.

- [ ] **Step 3: Thread `degrade_after` and wire the branches**

In `crates/evaluator/src/lib.rs`:

(a) Add the param to `run_evaluator` (insert `degrade_after: u32` before `shutdown`):

```rust
pub async fn run_evaluator(
    consumer: String,
    store: PgStore,
    queue: Arc<dyn Queue>,
    ch: Arc<dyn RowQuerier>,
    events: Arc<dyn EventBus>,
    degrade_after: u32,
    shutdown: tokio::sync::watch::Receiver<bool>,
) {
```

and pass it through at the `process_batch` call inside the loop:

```rust
let to_ack = process_batch(&store, ch.as_ref(), events.as_ref(), degrade_after, deliveries).await;
```

(b) Add the param to `process_batch`:

```rust
pub async fn process_batch(
    store: &PgStore,
    ch: &dyn RowQuerier,
    events: &dyn EventBus,
    degrade_after: u32,
    deliveries: Vec<Delivery>,
) -> Vec<JobId> {
```

(c) Add a shared publish helper (mirrors `publish_transition`'s recover-on-failure shape) above `process_batch`:

```rust
/// Publish a rule-health event written to the outbox in `record_rule_*`, deleting the row
/// on success. A failed publish leaves the row for the maintenance relay (exactly-once).
async fn publish_health(store: &PgStore, events: &dyn EventBus, ev: Event, id: uuid::Uuid) {
    match events.publish(&ev).await {
        Ok(()) => {
            if let Err(e) = store.delete_outbox(id).await {
                tracing::warn!(error = %e, "health outbox delete failed; relay will re-publish");
            }
        }
        Err(e) => tracing::warn!(error = %e, "health publish failed; relay will recover"),
    }
}
```

Add `use cc_domain::Event;` if not already imported (the file imports `cc_domain::Event` already — confirm).

(d) Replace the query-error arm body. Currently:

```rust
Err(e) => {
    for (job, _) in &members {
        tracing::error!(rule = ?job.rule, error = %e, "evaluation query errored");
        let _ = store.record_eval_error(job.rule, &e.to_string()).await;
    }
    continue;
}
```

with (cap the error to 500 chars; drive health per rule):

```rust
Err(e) => {
    let now = time::OffsetDateTime::now_utc();
    let msg: String = e.to_string().chars().take(500).collect();
    for (job, _) in &members {
        tracing::error!(rule = ?job.rule, error = %msg, "evaluation query errored");
        match store
            .record_rule_failure(job.rule, &job.tenant, &msg, degrade_after as i32, now)
            .await
        {
            Ok(Some((ev, id))) => publish_health(store, events, ev, id).await,
            Ok(None) => {}
            Err(err) => tracing::error!(rule = ?job.rule, error = %err, "record_rule_failure failed"),
        }
    }
    continue;
}
```

(e) In the success arm (after `Ok(r) => r`, before the per-rule `evaluate_rule_against_rows` loop), record per-rule success and publish any recovery:

```rust
let now = time::OffsetDateTime::now_utc();
for (job, _) in &members {
    match store.record_rule_success(job.rule, &job.tenant, now).await {
        Ok(Some((ev, id))) => publish_health(store, events, ev, id).await,
        Ok(None) => {}
        Err(err) => tracing::error!(rule = ?job.rule, error = %err, "record_rule_success failed"),
    }
}
```

Leave the evaluate-error branch (`evaluate_rule_against_rows(...) => Err`) and its `record_eval_error` unchanged — that is infra failure, not rule health.

- [ ] **Step 4: Update the `main.rs` call site**

In `src/main.rs:120`, pass the config threshold (the spawn block has `cfg` in scope; capture it like the other fields):

```rust
let degrade_after = cfg.rule_degrade_after;
// ...inside the spawned future:
run_evaluator(consumer, store, queue, ch, events, degrade_after, rx).await;
```

Place the `let degrade_after = cfg.rule_degrade_after;` next to the other `let consumer = ...;` captures so it moves into the async block.

- [ ] **Step 5: Update the existing `process_batch` test call sites**

In `crates/evaluator/tests/coalescing_it.rs`, every existing `process_batch(&store, &ch, &NoopBus, deliveries)` call (lines ~150, 202, 251, 294, 320) gains the threshold arg. Use a high value so coalescing tests never accidentally degrade:

```rust
process_batch(&store, &ch, &NoopBus, 1000, deliveries).await;
```

- [ ] **Step 6: Run tests**

Run each separately:
`cargo test -p cc-evaluator repeated_query_errors_degrade_then_recover`
`cargo test -p cc-evaluator` (full crate; one at a time)
`cargo build -p cc@0.1.0`
Expected: PASS; binary compiles with the threaded threshold.

- [ ] **Step 7: Commit**

```bash
git add crates/evaluator/src/lib.rs src/main.rs crates/evaluator/tests/coalescing_it.rs
git commit -m "Drive rule-health transitions from the evaluator query branches"
```

---

### Task 11: Routing — `kind` synthetic label

**Files:**
- Modify: `crates/dispatcher/src/routing.rs`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `crates/dispatcher/src/routing.rs`:

```rust
#[test]
fn kind_is_a_matchable_synthetic_label() {
    let mut e = ev(Severity::Critical, &[]);
    e.kind = cc_domain::EventKind::RuleHealth;
    let labels = match_labels(&e);
    assert_eq!(labels["kind"], "rule_health");

    let alert = match_labels(&ev(Severity::Info, &[]));
    assert_eq!(alert["kind"], "alert");

    // A health route selects health and not a plain alert.
    let routes = vec![route("ops", false, vec![m("kind", MatchOp::Eq, "rule_health")])];
    assert_eq!(select_receivers(&routes, &labels), vec!["ops"]);
    assert!(select_receivers(&routes, &alert).is_empty());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-dispatcher kind_is_a_matchable_synthetic_label`
Expected: FAIL — no `kind` label.

- [ ] **Step 3: Project `kind` into the label set**

In `crates/dispatcher/src/routing.rs`, add a `kind_str` helper and insert it in `synthetic_labels`. Change the `synthetic_labels` signature to take the kind, and update `match_labels`:

```rust
use cc_domain::EventKind;

fn kind_str(k: EventKind) -> &'static str {
    match k {
        EventKind::Alert => "alert",
        EventKind::RuleHealth => "rule_health",
    }
}

pub fn synthetic_labels(
    labels: &BTreeMap<String, String>,
    severity: Severity,
    status: EventStatus,
    rule: RuleId,
    kind: EventKind,
) -> BTreeMap<String, String> {
    let mut m = labels.clone();
    m.insert("severity".to_string(), severity_str(severity).to_string());
    m.insert("status".to_string(), status_str(status).to_string());
    m.insert("rule".to_string(), rule.0.to_string());
    m.insert("kind".to_string(), kind_str(kind).to_string());
    m
}

pub fn match_labels(ev: &Event) -> BTreeMap<String, String> {
    synthetic_labels(&ev.labels, ev.severity, ev.status, ev.rule, ev.kind)
}
```

If `synthetic_labels` has any other caller, update it to pass `EventKind::Alert`. Search: `grep -rn synthetic_labels crates/`.

- [ ] **Step 4: Run tests**

Run: `cargo test -p cc-dispatcher kind_is_a_matchable_synthetic_label` then `cargo test -p cc-dispatcher routing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/dispatcher/src/routing.rs
git commit -m "Project EventKind into a matchable kind routing label"
```

---

### Task 12: Renderers — `kind`-aware headline and status word

**Files:**
- Create: `crates/dispatcher/src/render.rs`
- Modify: `crates/dispatcher/src/lib.rs` (add `mod render;`)
- Modify: `crates/dispatcher/src/email.rs`, `slack.rs`, `pagerduty.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/dispatcher/src/render.rs` with the helpers and their tests:

```rust
//! Presentation helpers shared by the notification renderers.
use cc_domain::event::{Event, EventKind, EventStatus};

/// Human label for an event: the summary annotation for rule-health, else the instance key.
pub fn headline(ev: &Event) -> String {
    match ev.kind {
        EventKind::RuleHealth => ev
            .annotations
            .get("summary")
            .cloned()
            .unwrap_or_else(|| format!("rule {}", ev.rule.0)),
        EventKind::Alert => ev.instance_key.0.clone(),
    }
}

/// Status word: DEGRADED/RECOVERED for rule-health, FIRING/RESOLVED for alerts.
pub fn status_word(ev: &Event) -> &'static str {
    match (ev.kind, ev.status) {
        (EventKind::RuleHealth, EventStatus::Firing) => "DEGRADED",
        (EventKind::RuleHealth, EventStatus::Resolved) => "RECOVERED",
        (EventKind::Alert, EventStatus::Firing) => "FIRING",
        (EventKind::Alert, EventStatus::Resolved) => "RESOLVED",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::ids::{RuleId, TenantId};
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    #[test]
    fn health_uses_summary_and_degraded_word() {
        let mut ann = BTreeMap::new();
        ann.insert("summary".to_string(), "Rule X degraded after 3 consecutive failures".to_string());
        let ev = Event::rule_health(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            EventStatus::Firing,
            ann,
            OffsetDateTime::UNIX_EPOCH,
        );
        assert_eq!(status_word(&ev), "DEGRADED");
        assert!(headline(&ev).contains("degraded"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-dispatcher render::`
Expected: FAIL — `render` module not declared.

- [ ] **Step 3: Declare the module and use it in the renderers**

In `crates/dispatcher/src/lib.rs`, add `mod render;` next to the other `mod` declarations.

In `crates/dispatcher/src/email.rs`, replace the `n == 1` subject block:

```rust
    let subject = if n == 1 {
        let ev = &notif.events[0];
        format!(
            "[{}] {} {}",
            crate::render::status_word(ev),
            severity_str(ev.severity),
            crate::render::headline(ev)
        )
    } else {
        format!("[{n} alerts] {}", notif.group_key)
    };
```

In `crates/dispatcher/src/slack.rs`, replace the `n == 1` header block:

```rust
    let header = if n == 1 {
        let ev = &notif.events[0];
        let emoji = match ev.status {
            EventStatus::Firing => ":rotating_light:",
            EventStatus::Resolved => ":white_check_mark:",
        };
        format!(
            "{emoji} [{}] {} — {}",
            crate::render::status_word(ev),
            severity_str(ev.severity),
            crate::render::headline(ev)
        )
    } else {
        format!(":rotating_light: [{n} alerts] {}", notif.group_key)
    };
```

In `crates/dispatcher/src/pagerduty.rs`, change the `summary` to use the headline (action already maps Firing→trigger=degraded, Resolved→resolve=recovered correctly):

```rust
            "summary": format!("[{}] {}", pd_severity(ev.severity), crate::render::headline(ev)),
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p cc-dispatcher`
Expected: PASS (render tests + existing email/slack/pagerduty tests, whose `Event { ... }` literals already got `kind: Alert` in Task 1, so their subjects still read `[FIRING] ...`).

- [ ] **Step 5: Commit**

```bash
git add crates/dispatcher/src/render.rs crates/dispatcher/src/lib.rs crates/dispatcher/src/email.rs crates/dispatcher/src/slack.rs crates/dispatcher/src/pagerduty.rs
git commit -m "Render rule-health notifications with degraded/recovered wording"
```

---

### Task 13: API — health on rule GET and minimal filtered list

**Files:**
- Modify: `crates/api/src/rules.rs`
- Test: `crates/api/tests/` (extend the existing rules integration test, or add `rules_health_it.rs`)

- [ ] **Step 1: Write the failing test**

Add an integration test that creates a rule, degrades it via the store, and asserts the GET and list responses. Model it on the existing API tests in `crates/api/tests/` (reuse their app-spawn / request helpers). Assertions:

```rust
// GET /v1/rules/:id includes a health object.
let body = get_rule(&app, &tenant, rule_id).await; // existing helper returning serde_json::Value
assert_eq!(body["health"]["status"], "degraded");
assert_eq!(body["health"]["consecutive_failures"], 1);
assert_eq!(body["health"]["last_error"], "boom");

// GET /v1/rules?health=degraded returns the rule; ?health=healthy does not.
let degraded = list_rules(&app, &tenant, Some("degraded")).await;
assert_eq!(degraded.as_array().unwrap().len(), 1);
let healthy = list_rules(&app, &tenant, Some("healthy")).await;
assert_eq!(healthy.as_array().unwrap().len(), 0);
```

> Use the test crate's existing helpers; if degrading directly via the store from an API test is awkward, call `store.record_rule_failure(rule, &tenant, "boom", 1, now)` on the same `PgStore` the app was built with.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cc-api rules_health`
Expected: FAIL — `health` absent; list returns `[]`.

- [ ] **Step 3: Implement the view, GET, and list**

In `crates/api/src/rules.rs`:

Add imports:

```rust
use axum::extract::Query;
use cc_domain::rule::RuleHealth;
use serde::{Deserialize, Serialize};
```

Add a view type and a list-params type:

```rust
/// Rule representation with its health, returned by GET and list.
#[derive(Serialize)]
struct RuleView {
    #[serde(flatten)]
    rule: Rule,
    health: RuleHealth,
}

#[derive(Deserialize)]
pub struct ListParams {
    /// Optional health filter: "degraded" or "healthy".
    health: Option<String>,
}
```

Replace the `get` handler to return health:

```rust
pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<RuleView>, ApiError> {
    let t = tenant(&state, &headers)?;
    let (rule, health) = state
        .store
        .get_rule_with_health(t, RuleId(id))
        .await
        .map_err(ApiError::from)?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(RuleView { rule, health }))
}
```

(Match the existing `get` error mapping: keep whatever `ApiError` conversions/`NotFound` variant the file already uses — adjust `.map_err`/`.ok_or` to the established pattern in this file.)

Replace the `list` stub:

```rust
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ListParams>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let filter = match params.health.as_deref() {
        None => None,
        Some("degraded") => Some("degraded"),
        Some("healthy") => Some("healthy"),
        Some(other) => {
            return Err(ApiError::Validation(format!(
                "invalid health filter: {other} (expected 'degraded' or 'healthy')"
            )))
        }
    };
    let rules = state.store.list_rules(&t, filter).await.map_err(ApiError::from)?;
    let views: Vec<Value> = rules
        .into_iter()
        .map(|(rule, health)| serde_json::to_value(RuleView { rule, health }).unwrap())
        .collect();
    Ok(Json(Value::Array(views)))
}
```

- [ ] **Step 4: Run test**

Run: `cargo test -p cc-api rules_health`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/api/src/rules.rs crates/api/tests/
git commit -m "Expose rule health on GET and add filtered rule listing"
```

---

### Task 14: Docs

**Files:**
- Create: `docs/how-to/observe-degraded-rules.md`
- Modify: `docs/reference/configuration.md`
- Modify: the evaluation/state-machine explanation page (find it under `docs/explanation/` or `docs/reference/`)

- [ ] **Step 1: Write the how-to**

Create `docs/how-to/observe-degraded-rules.md` covering:
- What "degraded" means: K consecutive evaluation-query failures (`CC_RULE_DEGRADE_AFTER`, default 3); causes (CH down, timeout, schema drift, result-row cap, per-tenant auth misprovision).
- How to route health: add a route matching `kind="rule_health"` to your oncall receiver; health events are fixed `critical` severity.
- How to silence health: a silence with a `kind="rule_health"` matcher (optionally `rule=<id>`).
- How to inspect: `GET /v1/rules/:id` → `health` object; `GET /v1/rules?health=degraded` to list all degraded rules.
- Recovery: the first successful evaluation emits a `RECOVERED` notification; it does **not** resolve the rule's data alerts (they were frozen, never re-evaluated).

- [ ] **Step 2: Document the config var**

In `docs/reference/configuration.md`, add a row/section for `CC_RULE_DEGRADE_AFTER` (u32, default `3`, min 1): consecutive evaluation-query failures before a rule is marked degraded and a `rule_health` notification fires.

- [ ] **Step 3: Note the separate health axis**

In the state-machine/evaluation explanation page, add a short note: rule **health** (`healthy`/`degraded`) is a separate axis from the per-instance state machine (`inactive`/`pending`/`firing`/`resolved`). Health lives on the rule; a degraded rule's instances are frozen and are never auto-resolved by the stale reaper.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "Document rule health observability and configuration"
```

---

## Self-Review

**Spec coverage:**
- §1 event model → Task 1 (`EventKind`, field, constructor) + Task 11 (`kind` label). ✓
- §2 failure scope (query-error only) → Task 10 step 3d/3e (query arm vs. evaluate arm untouched). ✓
- §3 health columns → Task 3. ✓
- §4 store transitions + outbox → Tasks 6, 7; evaluator publish helper → Task 10. ✓
- §5 reaper guard → Task 5. ✓
- §6 fixed Critical severity → Task 1 (`rule_health` hardcodes Critical) + tested in Task 6. ✓
- §7 secret hygiene → Task 4 (URL scrub) + Task 10 (500-char cap). ✓
- §8 paused interaction → no code; covered by Task 5 guard + existing pause drop (noted in spec). ✓
- §9 renderers → Task 12. ✓
- §10 API → Task 13 (get + minimal list + filter). ✓ (list is intentionally unpaginated; pagination remains a pre-existing separate task.)
- §11 config → Task 9 + Task 10 wiring. ✓
- §12 docs → Task 14. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Test files that depend on the stores/api/evaluator test harnesses explicitly instruct the implementer to inspect and reuse existing helper names (the one place exact names can't be known without reading those files) rather than inventing them.

**Type consistency:** `record_rule_failure(rule, &tenant, err, threshold: i32, now)` and `record_rule_success(rule, &tenant, now)` return `Option<(Event, Uuid)>` — used identically in Tasks 6/7 and consumed in Task 10. `RuleHealth` fields (Task 2) match `health_from_row` and the API view (Tasks 8, 13). `EventKind` variants (`Alert`, `RuleHealth`) and `Event::rule_health` arity are consistent across Tasks 1, 6, 7, 11, 12. `synthetic_labels` gains a `kind` param consistently (Task 11). `degrade_after: u32` threaded config→`run_evaluator`→`process_batch`→`as i32` at the store call (Tasks 9, 10).
