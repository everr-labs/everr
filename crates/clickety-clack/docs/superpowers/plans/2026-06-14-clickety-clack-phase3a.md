# Phase 3A — Silences + Inhibition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add silence and inhibition filters at the front of the dispatch pipeline (`silence → inhibition → routing → grouping → dedup → delivery`), fed by a per-replica 2s TTL cache.

**Architecture:** New `cc-domain` types (`Silence`, `InhibitionRule`, `FiringInstance`); Postgres storage (migration `0005`) + store methods; pure dispatcher modules (`matching`, `silence`, `inhibition`) sharing one matcher engine; a `FilterCache` that snapshots per-tenant silences/inhibitions/firing-set; filters wired at the top of `process_event` (both firehose and routed paths); six tenant-scoped API endpoints. Silences and inhibition suppress both `firing` and `resolved` events. Pub/sub cache invalidation is deferred (separate Phase 3 item) — the per-event path is identical, so it layers on later.

**Tech Stack:** Rust workspace (tokio, axum 0.7, sqlx 0.8 Postgres/JSONB, regex, time, serde, uuid), testcontainers (Postgres + Redis).

**Spec:** `docs/superpowers/specs/2026-06-14-clickety-clack-phase3a-silences-inhibition.md`

**Conventions:** TDD; `cargo clippy --all-targets -- -D warnings` clean; real gate `cargo test --workspace --no-fail-fast`. The package name `cc` is ambiguous with the build-dep `cc` crate — disambiguate with `-p cc@0.1.0`. Stale rust-analyzer/rustc diagnostics are NOT authoritative; verify with `cargo`. **No Claude/Anthropic/AI attribution anywhere** in commits, PR text, or code comments.

---

## File Structure

| File | Responsibility |
|---|---|
| `crates/domain/src/silence.rs` (create) | `Silence` type + `is_active` |
| `crates/domain/src/inhibition.rs` (create) | `InhibitionRule` type |
| `crates/domain/src/instance.rs` (modify) | add `FiringInstance` |
| `crates/domain/src/lib.rs` (modify) | module decls + re-exports |
| `migrations/0005_silences_inhibitions.sql` (create) | `silences` + `inhibitions` tables |
| `crates/stores/src/pg.rs` (modify) | silence/inhibition CRUD + `list_firing` |
| `crates/stores/tests/silences_it.rs` (create) | silence store IT |
| `crates/stores/tests/inhibitions_it.rs` (create) | inhibition + `list_firing` store IT |
| `crates/dispatcher/src/matching.rs` (create) | shared matcher engine |
| `crates/dispatcher/src/routing.rs` (modify) | use `matching`; add `synthetic_labels` |
| `crates/dispatcher/src/silence.rs` (create) | pure `is_silenced` |
| `crates/dispatcher/src/inhibition.rs` (create) | pure `is_inhibited` |
| `crates/dispatcher/src/cache.rs` (create) | `FilterCache` + `Snapshot` |
| `crates/dispatcher/src/lib.rs` (modify) | module decls; wire filters into `process_event`; `run_dispatcher` gains `cache` param |
| `crates/dispatcher/Cargo.toml` (modify) | add `uuid` dependency |
| `crates/dispatcher/tests/cache_it.rs` (create) | TTL cache IT |
| `crates/api/src/silences.rs` (create) | silence endpoints |
| `crates/api/src/inhibitions.rs` (create) | inhibition endpoints |
| `crates/api/src/lib.rs` (modify) | module decls + routes |
| `crates/api/tests/silences_api.rs` (create) | API IT |
| `src/main.rs` (modify) | build `FilterCache`, pass to `run_dispatcher` |
| `tests/e2e_silences_inhibition.rs` (create) | end-to-end suppression |
| `tests/e2e_dispatch.rs`, `tests/e2e_routing.rs`, `tests/e2e_grouping.rs`, `crates/dispatcher/tests/dispatch_it.rs`, `crates/dispatcher/tests/routing_dispatch_it.rs` (modify) | update `run_dispatcher` call sites |

---

## Task 1: Domain types

**Files:**
- Create: `crates/domain/src/silence.rs`
- Create: `crates/domain/src/inhibition.rs`
- Modify: `crates/domain/src/instance.rs`
- Modify: `crates/domain/src/lib.rs`

- [ ] **Step 1: Write `silence.rs` with a failing test**

Create `crates/domain/src/silence.rs`:

```rust
use crate::ids::TenantId;
use crate::routing::Matcher;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// A suppression window: while active, events whose labels match every matcher are dropped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Silence {
    pub id: Uuid,
    pub tenant: TenantId,
    pub matchers: Vec<Matcher>,
    #[serde(with = "time::serde::rfc3339")]
    pub starts_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub ends_at: OffsetDateTime,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub author: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl Silence {
    /// Active when `starts_at <= now < ends_at`.
    pub fn is_active(&self, now: OffsetDateTime) -> bool {
        self.starts_at <= now && now < self.ends_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routing::{MatchOp, Matcher};
    use time::Duration;

    fn silence(start: OffsetDateTime, end: OffsetDateTime) -> Silence {
        Silence {
            id: Uuid::nil(),
            tenant: TenantId(Uuid::nil()),
            matchers: vec![Matcher { label: "svc".into(), op: MatchOp::Eq, value: "api".into() }],
            starts_at: start,
            ends_at: end,
            comment: "maint".into(),
            author: "ops".into(),
            created_at: start,
        }
    }

    #[test]
    fn active_window_is_start_inclusive_end_exclusive() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let s = silence(now, now + Duration::seconds(10));
        assert!(s.is_active(now), "start is inclusive");
        assert!(s.is_active(now + Duration::seconds(9)));
        assert!(!s.is_active(now + Duration::seconds(10)), "end is exclusive");
        assert!(!s.is_active(now - Duration::seconds(1)), "before start");
    }

    #[test]
    fn silence_roundtrips_json() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let s = silence(now, now + Duration::seconds(10));
        let v = serde_json::to_value(&s).unwrap();
        let back: Silence = serde_json::from_value(v).unwrap();
        assert_eq!(back, s);
    }
}
```

- [ ] **Step 2: Add `inhibition.rs`**

Create `crates/domain/src/inhibition.rs`:

```rust
use crate::ids::TenantId;
use crate::routing::Matcher;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Suppress a target alert while a matching higher-priority source alert is firing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InhibitionRule {
    pub id: Uuid,
    pub tenant: TenantId,
    pub source_matchers: Vec<Matcher>,
    pub target_matchers: Vec<Matcher>,
    /// Label names that must hold equal values between source and target.
    #[serde(default)]
    pub equal: Vec<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routing::{MatchOp, Matcher};

    #[test]
    fn inhibition_roundtrips_json() {
        let r = InhibitionRule {
            id: Uuid::nil(),
            tenant: TenantId(Uuid::nil()),
            source_matchers: vec![Matcher { label: "severity".into(), op: MatchOp::Eq, value: "critical".into() }],
            target_matchers: vec![Matcher { label: "severity".into(), op: MatchOp::Eq, value: "warning".into() }],
            equal: vec!["instance".into()],
            created_at: OffsetDateTime::UNIX_EPOCH,
        };
        let v = serde_json::to_value(&r).unwrap();
        let back: InhibitionRule = serde_json::from_value(v).unwrap();
        assert_eq!(back, r);
    }
}
```

- [ ] **Step 3: Add `FiringInstance` to `instance.rs`**

At the top of `crates/domain/src/instance.rs`, the imports are currently:
```rust
use crate::ids::{InstanceKey, RuleId, TenantId};
```
Change to add `Severity`:
```rust
use crate::ids::{InstanceKey, RuleId, TenantId};
use crate::rule::Severity;
```
Then append this type to the file (after the `InstanceState` impl):

```rust
/// A currently-firing alert instance, enriched with its rule's severity, used as the
/// inhibition source-set. `severity` is read from the rule (not stored on the instance row).
#[derive(Debug, Clone, PartialEq)]
pub struct FiringInstance {
    pub key: InstanceKey,
    pub rule: RuleId,
    pub severity: Severity,
    pub labels: BTreeMap<String, String>,
}
```

- [ ] **Step 4: Wire module decls + re-exports in `lib.rs`**

In `crates/domain/src/lib.rs`, add the two module decls (keep alphabetical with the existing `pub mod` block) and re-exports. Resulting relevant lines:

```rust
pub mod event;
pub mod ids;
pub mod inhibition;
pub mod instance;
pub mod receiver;
pub mod routing;
pub mod rule;
pub mod silence;
pub mod subscription;

pub use event::{Event, EventStatus};
pub use ids::{InstanceKey, RuleId, TenantId};
pub use inhibition::InhibitionRule;
pub use instance::{FiringInstance, InstanceState, Status};
pub use receiver::{ChannelConfig, Receiver};
pub use routing::{MatchOp, Matcher, Route};
pub use rule::{Rule, RuleSpec, Severity};
pub use silence::Silence;
pub use subscription::Subscription;
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p cc-domain`
Expected: PASS (new silence/inhibition tests + existing domain tests).

- [ ] **Step 6: Clippy + commit**

Run: `cargo clippy -p cc-domain --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/domain/src/silence.rs crates/domain/src/inhibition.rs crates/domain/src/instance.rs crates/domain/src/lib.rs
git commit -m "feat(domain): Silence, InhibitionRule, FiringInstance types"
```

---

## Task 2: Migration + silence store methods

**Files:**
- Create: `migrations/0005_silences_inhibitions.sql`
- Modify: `crates/stores/src/pg.rs`
- Test: `crates/stores/tests/silences_it.rs`

- [ ] **Step 1: Write the migration**

Create `migrations/0005_silences_inhibitions.sql`:

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

(Both tables are created here so Task 3 needs no second migration.)

- [ ] **Step 2: Write the failing IT**

Create `crates/stores/tests/silences_it.rs`:

```rust
use cc_domain::ids::TenantId;
use cc_domain::routing::{MatchOp, Matcher};
use cc_stores::PgStore;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

async fn store() -> PgStore {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    // Leak the container so it outlives the test body (matches other store ITs that
    // keep `node` bound for the whole test).
    std::mem::forget(node);
    let s = PgStore::connect(&url).await.unwrap();
    s.migrate().await.unwrap();
    s
}

fn m(label: &str, value: &str) -> Matcher {
    Matcher { label: label.into(), op: MatchOp::Eq, value: value.into() }
}

#[tokio::test]
async fn silence_crud_and_active_window() {
    let store = store().await;
    let tenant = TenantId(Uuid::new_v4());
    let now = OffsetDateTime::now_utc();

    let active = store
        .create_silence(tenant, &[m("svc", "api")], now - Duration::seconds(5), now + Duration::seconds(60), "maint", "ops")
        .await
        .unwrap();
    let _past = store
        .create_silence(tenant, &[m("svc", "api")], now - Duration::seconds(120), now - Duration::seconds(60), "old", "ops")
        .await
        .unwrap();
    let _future = store
        .create_silence(tenant, &[m("svc", "api")], now + Duration::seconds(60), now + Duration::seconds(120), "later", "ops")
        .await
        .unwrap();

    assert_eq!(store.list_silences(tenant).await.unwrap().len(), 3, "list returns all");

    let act = store.list_active_silences(tenant, now).await.unwrap();
    assert_eq!(act.len(), 1, "only the window-covering silence is active");
    assert_eq!(act[0].id, active.id);

    assert!(store.delete_silence(tenant, active.id).await.unwrap());
    assert!(!store.delete_silence(tenant, active.id).await.unwrap(), "second delete is a no-op");
    assert_eq!(store.list_silences(tenant).await.unwrap().len(), 2);
}
```

> Note on `std::mem::forget(node)`: the existing store ITs keep the container handle (`node`/`pg`) bound for the whole test so it isn't dropped early. The helper above uses `forget` to achieve the same lifetime from inside a helper fn. If you prefer, inline the container setup into the test body (as `routing_it.rs` does) and drop the helper — either is fine; do NOT let the container drop before the queries run.

- [ ] **Step 3: Run it to confirm failure**

Run: `cargo test -p cc-stores --test silences_it`
Expected: FAIL to compile — `create_silence`/`list_silences`/`list_active_silences`/`delete_silence` don't exist.

- [ ] **Step 4: Implement the store methods**

In `crates/stores/src/pg.rs`, add to the imports at the top:
```rust
use cc_domain::silence::Silence;
```
Add a row helper near `row_to_instance`:

```rust
fn row_to_silence(r: &sqlx::postgres::PgRow) -> Result<Silence, StoreError> {
    Ok(Silence {
        id: r.get("id"),
        tenant: TenantId(r.get("tenant")),
        matchers: serde_json::from_value(r.get("matchers"))?,
        starts_at: r.get("starts_at"),
        ends_at: r.get("ends_at"),
        comment: r.get("comment"),
        author: r.get("author"),
        created_at: r.get("created_at"),
    })
}
```

Add these methods inside `impl PgStore` (near the routing methods):

```rust
    pub async fn create_silence(
        &self,
        tenant: TenantId,
        matchers: &[Matcher],
        starts_at: OffsetDateTime,
        ends_at: OffsetDateTime,
        comment: &str,
        author: &str,
    ) -> Result<Silence, StoreError> {
        let id = Uuid::new_v4();
        let m_json = serde_json::to_value(matchers)?;
        let created_at = OffsetDateTime::now_utc();
        sqlx::query(
            "INSERT INTO silences (id, tenant, matchers, starts_at, ends_at, comment, author, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(id)
        .bind(tenant.0)
        .bind(&m_json)
        .bind(starts_at)
        .bind(ends_at)
        .bind(comment)
        .bind(author)
        .bind(created_at)
        .execute(&self.pool)
        .await?;
        Ok(Silence {
            id,
            tenant,
            matchers: matchers.to_vec(),
            starts_at,
            ends_at,
            comment: comment.to_string(),
            author: author.to_string(),
            created_at,
        })
    }

    pub async fn list_silences(&self, tenant: TenantId) -> Result<Vec<Silence>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, matchers, starts_at, ends_at, comment, author, created_at
             FROM silences WHERE tenant=$1 ORDER BY created_at DESC",
        )
        .bind(tenant.0)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_silence).collect()
    }

    pub async fn list_active_silences(
        &self,
        tenant: TenantId,
        now: OffsetDateTime,
    ) -> Result<Vec<Silence>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, matchers, starts_at, ends_at, comment, author, created_at
             FROM silences WHERE tenant=$1 AND starts_at <= $2 AND ends_at > $2",
        )
        .bind(tenant.0)
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_silence).collect()
    }

    pub async fn delete_silence(&self, tenant: TenantId, id: Uuid) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM silences WHERE tenant=$1 AND id=$2")
            .bind(tenant.0)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
```

- [ ] **Step 5: Run the IT**

Run: `cargo test -p cc-stores --test silences_it`
Expected: PASS (Docker required).

- [ ] **Step 6: Clippy + commit**

Run: `cargo clippy -p cc-stores --all-targets -- -D warnings`
Expected: clean.

```bash
git add migrations/0005_silences_inhibitions.sql crates/stores/src/pg.rs crates/stores/tests/silences_it.rs
git commit -m "feat(stores): silences table and CRUD with active-window query"
```

---

## Task 3: Inhibition store methods + `list_firing`

**Files:**
- Modify: `crates/stores/src/pg.rs`
- Test: `crates/stores/tests/inhibitions_it.rs`

- [ ] **Step 1: Write the failing IT**

Create `crates/stores/tests/inhibitions_it.rs`:

```rust
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::instance::{InstanceState, Status};
use cc_domain::routing::{MatchOp, Matcher};
use cc_domain::rule::{RuleSpec, Severity};
use cc_stores::PgStore;
use std::collections::BTreeMap;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

async fn store() -> PgStore {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    std::mem::forget(node);
    let s = PgStore::connect(&url).await.unwrap();
    s.migrate().await.unwrap();
    s
}

fn m(label: &str, value: &str) -> Matcher {
    Matcher { label: label.into(), op: MatchOp::Eq, value: value.into() }
}

#[tokio::test]
async fn inhibition_crud() {
    let store = store().await;
    let tenant = TenantId(Uuid::new_v4());

    let rule = store
        .create_inhibition(tenant, &[m("severity", "critical")], &[m("severity", "warning")], &["instance".to_string()])
        .await
        .unwrap();
    assert_eq!(store.list_inhibitions(tenant).await.unwrap().len(), 1);
    assert!(store.delete_inhibition(tenant, rule.id).await.unwrap());
    assert!(!store.delete_inhibition(tenant, rule.id).await.unwrap());
    assert!(store.list_inhibitions(tenant).await.unwrap().is_empty());
}

#[tokio::test]
async fn list_firing_returns_only_firing_with_severity() {
    let store = store().await;
    let tenant = TenantId(Uuid::new_v4());

    let spec = RuleSpec {
        sql: "SELECT 1 AS n".into(),
        interval_secs: 1,
        for_secs: 0,
        label_columns: vec![],
        value_column: Some("n".into()),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        resolve_after: 1,
    };
    let rule = store.create_rule(tenant, &spec).await.unwrap();

    let mut labels = BTreeMap::new();
    labels.insert("instance".to_string(), "db1".to_string());
    let key = InstanceKey::new(rule.id, &labels);

    let mut firing = InstanceState::new_inactive(key.clone(), rule.id, tenant, labels.clone());
    firing.status = Status::Firing;
    firing.active_since = Some(OffsetDateTime::now_utc());
    store.upsert_instance(&firing).await.unwrap();

    // A pending instance must NOT appear in the firing-set.
    let mut plabels = BTreeMap::new();
    plabels.insert("instance".to_string(), "db2".to_string());
    let pkey = InstanceKey::new(rule.id, &plabels);
    let mut pending = InstanceState::new_inactive(pkey, rule.id, tenant, plabels);
    pending.status = Status::Pending;
    store.upsert_instance(&pending).await.unwrap();

    let got = store.list_firing(tenant).await.unwrap();
    assert_eq!(got.len(), 1, "only the firing instance");
    assert_eq!(got[0].key, key);
    assert_eq!(got[0].severity, Severity::Critical, "severity comes from the rule");
    assert_eq!(got[0].labels.get("instance").map(String::as_str), Some("db1"));
}
```

- [ ] **Step 2: Run it to confirm failure**

Run: `cargo test -p cc-stores --test inhibitions_it`
Expected: FAIL to compile — methods don't exist.

- [ ] **Step 3: Implement the store methods**

In `crates/stores/src/pg.rs`, extend the existing instance import to add `FiringInstance`. The current line is:
```rust
use cc_domain::instance::{InstanceState, Status};
```
Change to:
```rust
use cc_domain::instance::{FiringInstance, InstanceState, Status};
```
Add an import for the inhibition type:
```rust
use cc_domain::inhibition::InhibitionRule;
```
(`RuleSpec` is already imported via `use cc_domain::rule::{Rule, RuleSpec};`.)

Add a row helper:

```rust
fn row_to_inhibition(r: &sqlx::postgres::PgRow) -> Result<InhibitionRule, StoreError> {
    Ok(InhibitionRule {
        id: r.get("id"),
        tenant: TenantId(r.get("tenant")),
        source_matchers: serde_json::from_value(r.get("source_matchers"))?,
        target_matchers: serde_json::from_value(r.get("target_matchers"))?,
        equal: serde_json::from_value(r.get("equal"))?,
        created_at: r.get("created_at"),
    })
}
```

Add these methods inside `impl PgStore`:

```rust
    pub async fn create_inhibition(
        &self,
        tenant: TenantId,
        source_matchers: &[Matcher],
        target_matchers: &[Matcher],
        equal: &[String],
    ) -> Result<InhibitionRule, StoreError> {
        let id = Uuid::new_v4();
        let src = serde_json::to_value(source_matchers)?;
        let tgt = serde_json::to_value(target_matchers)?;
        let eq = serde_json::to_value(equal)?;
        let created_at = OffsetDateTime::now_utc();
        sqlx::query(
            "INSERT INTO inhibitions (id, tenant, source_matchers, target_matchers, equal, created_at)
             VALUES ($1,$2,$3,$4,$5,$6)",
        )
        .bind(id)
        .bind(tenant.0)
        .bind(&src)
        .bind(&tgt)
        .bind(&eq)
        .bind(created_at)
        .execute(&self.pool)
        .await?;
        Ok(InhibitionRule {
            id,
            tenant,
            source_matchers: source_matchers.to_vec(),
            target_matchers: target_matchers.to_vec(),
            equal: equal.to_vec(),
            created_at,
        })
    }

    pub async fn list_inhibitions(&self, tenant: TenantId) -> Result<Vec<InhibitionRule>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, source_matchers, target_matchers, equal, created_at
             FROM inhibitions WHERE tenant=$1 ORDER BY created_at ASC",
        )
        .bind(tenant.0)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_inhibition).collect()
    }

    pub async fn delete_inhibition(&self, tenant: TenantId, id: Uuid) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM inhibitions WHERE tenant=$1 AND id=$2")
            .bind(tenant.0)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    /// Firing instances for a tenant, enriched with the rule's severity (read from the
    /// rule spec). Used as the inhibition source-set.
    pub async fn list_firing(&self, tenant: TenantId) -> Result<Vec<FiringInstance>, StoreError> {
        let rows = sqlx::query(
            "SELECT i.key AS key, i.rule AS rule, i.labels AS labels, r.spec AS spec
             FROM instances i JOIN rules r ON r.id = i.rule
             WHERE i.tenant=$1 AND i.status='firing'",
        )
        .bind(tenant.0)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let labels: BTreeMap<String, String> = serde_json::from_value(r.get("labels"))?;
            let spec: RuleSpec = serde_json::from_value(r.get("spec"))?;
            out.push(FiringInstance {
                key: InstanceKey(r.get("key")),
                rule: RuleId(r.get("rule")),
                severity: spec.severity,
                labels,
            });
        }
        Ok(out)
    }
```

- [ ] **Step 4: Run the IT**

Run: `cargo test -p cc-stores --test inhibitions_it`
Expected: PASS (Docker required).

- [ ] **Step 5: Clippy + commit**

Run: `cargo clippy -p cc-stores --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/stores/src/pg.rs crates/stores/tests/inhibitions_it.rs
git commit -m "feat(stores): inhibition CRUD and firing-set query with severity"
```

---

## Task 4: Shared matcher engine

**Files:**
- Create: `crates/dispatcher/src/matching.rs`
- Modify: `crates/dispatcher/src/routing.rs`
- Modify: `crates/dispatcher/src/lib.rs`

- [ ] **Step 1: Create `matching.rs` with tests**

Create `crates/dispatcher/src/matching.rs`:

```rust
//! The single matcher engine shared by routing, silences, and inhibition.

use cc_domain::routing::{MatchOp, Matcher};
use std::collections::BTreeMap;

/// Anchored (full-string) regex match. An invalid pattern never matches.
pub fn regex_full_match(pattern: &str, val: &str) -> bool {
    match regex::Regex::new(&format!("^(?:{pattern})$")) {
        Ok(re) => re.is_match(val),
        Err(_) => false,
    }
}

/// Match one matcher against a label set. A missing label is the empty string
/// (Alertmanager-like): `severity != critical` is true when `severity` is absent.
pub fn matcher_matches(m: &Matcher, labels: &BTreeMap<String, String>) -> bool {
    let val = labels.get(&m.label).map(|s| s.as_str()).unwrap_or("");
    match m.op {
        MatchOp::Eq => val == m.value,
        MatchOp::Ne => val != m.value,
        MatchOp::Regex => regex_full_match(&m.value, val),
        MatchOp::NotRegex => !regex_full_match(&m.value, val),
    }
}

/// All matchers must match. An empty matcher list matches everything.
pub fn matchers_match(matchers: &[Matcher], labels: &BTreeMap<String, String>) -> bool {
    matchers.iter().all(|m| matcher_matches(m, labels))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }
    fn m(label: &str, op: MatchOp, value: &str) -> Matcher {
        Matcher { label: label.into(), op, value: value.into() }
    }

    #[test]
    fn empty_matchers_match_everything() {
        assert!(matchers_match(&[], &labels(&[("a", "b")])));
    }

    #[test]
    fn eq_and_ne() {
        let l = labels(&[("svc", "api")]);
        assert!(matcher_matches(&m("svc", MatchOp::Eq, "api"), &l));
        assert!(!matcher_matches(&m("svc", MatchOp::Eq, "web"), &l));
        assert!(matcher_matches(&m("svc", MatchOp::Ne, "web"), &l));
    }

    #[test]
    fn missing_label_is_empty_string() {
        let l = labels(&[]);
        assert!(!matcher_matches(&m("svc", MatchOp::Eq, "api"), &l));
        assert!(matcher_matches(&m("svc", MatchOp::Ne, "api"), &l));
    }

    #[test]
    fn regex_is_anchored() {
        let l = labels(&[("svc", "api")]);
        assert!(matcher_matches(&m("svc", MatchOp::Regex, "api"), &l));
        assert!(!matcher_matches(&m("svc", MatchOp::Regex, "ap"), &l), "anchored, not a prefix");
        assert!(matcher_matches(&m("svc", MatchOp::Regex, "ap.*"), &l));
        assert!(matcher_matches(&m("svc", MatchOp::NotRegex, "web"), &l));
    }

    #[test]
    fn invalid_pattern_never_matches() {
        let l = labels(&[("svc", "api")]);
        assert!(!matcher_matches(&m("svc", MatchOp::Regex, "[unterminated"), &l));
    }

    #[test]
    fn all_matchers_must_match() {
        let l = labels(&[("svc", "api"), ("env", "prod")]);
        assert!(matchers_match(&[m("svc", MatchOp::Eq, "api"), m("env", MatchOp::Eq, "prod")], &l));
        assert!(!matchers_match(&[m("svc", MatchOp::Eq, "api"), m("env", MatchOp::Eq, "dev")], &l));
    }
}
```

- [ ] **Step 2: Refactor `routing.rs` to use `matching` and add `synthetic_labels`**

In `crates/dispatcher/src/routing.rs`:

(a) Delete the local `regex_full_match` and `matcher_matches` functions (lines around 36–53 in the current file).

(b) Update imports. The file currently uses `Event`, `Severity`, `EventStatus`, `Matcher`, `MatchOp`, `BTreeMap`, `Route`. Add `RuleId` and the `matching` re-use:
```rust
use crate::matching::{matcher_matches, matchers_match};
use cc_domain::ids::RuleId;
```
Remove `MatchOp` from imports if it is now unused (the deleted `matcher_matches` was its only user — confirm with clippy and drop it if flagged).

(c) Replace `route_matches` to use `matchers_match`:
```rust
fn route_matches(r: &Route, labels: &BTreeMap<String, String>) -> bool {
    matchers_match(&r.matchers, labels)
}
```
(`matcher_matches` may still be referenced by existing routing tests; keep the import only if used — otherwise import just `matchers_match`. Let clippy decide.)

(d) Extract `synthetic_labels` and make `match_labels` delegate. Replace the current `match_labels` function with:

```rust
/// Build the matchable label set from raw labels + synthetic `severity`/`status`/`rule`.
/// Synthetic labels take precedence over any same-named user label (inserted last).
pub fn synthetic_labels(
    labels: &BTreeMap<String, String>,
    severity: Severity,
    status: EventStatus,
    rule: RuleId,
) -> BTreeMap<String, String> {
    let mut m = labels.clone();
    m.insert("severity".to_string(), severity_str(severity).to_string());
    m.insert("status".to_string(), status_str(status).to_string());
    m.insert("rule".to_string(), rule.0.to_string());
    m
}

/// The matchable label set for an event.
pub fn match_labels(ev: &Event) -> BTreeMap<String, String> {
    synthetic_labels(&ev.labels, ev.severity, ev.status, ev.rule)
}
```

Keep the existing `severity_str` / `status_str` private helpers as-is.

- [ ] **Step 3: Register the module**

In `crates/dispatcher/src/lib.rs`, add `pub mod matching;` to the module block (alphabetical: after `grouping`, before `notify`):
```rust
pub mod dedup;
pub mod email;
pub mod grouping;
pub mod matching;
pub mod notify;
pub mod pagerduty;
pub mod registry;
pub mod retry;
pub mod routing;
pub mod slack;
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p cc-dispatcher --lib`
Expected: PASS — new `matching` tests plus all existing routing tests (behavior unchanged).

- [ ] **Step 5: Clippy + commit**

Run: `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`
Expected: clean (fix any now-unused import flagged on `routing.rs`).

```bash
git add crates/dispatcher/src/matching.rs crates/dispatcher/src/routing.rs crates/dispatcher/src/lib.rs
git commit -m "refactor(dispatcher): shared matcher engine and synthetic_labels"
```

---

## Task 5: Silence filter (pure)

**Files:**
- Create: `crates/dispatcher/src/silence.rs`
- Modify: `crates/dispatcher/src/lib.rs`

- [ ] **Step 1: Write `silence.rs` with tests**

Create `crates/dispatcher/src/silence.rs`:

```rust
//! Stage 2 of the dispatch pipeline: drop events matching an active silence.

use crate::matching::matchers_match;
use cc_domain::silence::Silence;
use std::collections::BTreeMap;
use time::OffsetDateTime;

/// True if any silence that is active at `now` matches every label via its matchers.
pub fn is_silenced(labels: &BTreeMap<String, String>, silences: &[Silence], now: OffsetDateTime) -> bool {
    silences
        .iter()
        .any(|s| s.is_active(now) && matchers_match(&s.matchers, labels))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::ids::TenantId;
    use cc_domain::routing::{MatchOp, Matcher};
    use time::Duration;
    use uuid::Uuid;

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn silence(matchers: Vec<Matcher>, start: OffsetDateTime, end: OffsetDateTime) -> Silence {
        Silence {
            id: Uuid::nil(),
            tenant: TenantId(Uuid::nil()),
            matchers,
            starts_at: start,
            ends_at: end,
            comment: String::new(),
            author: String::new(),
            created_at: start,
        }
    }
    fn m(label: &str, value: &str) -> Matcher {
        Matcher { label: label.into(), op: MatchOp::Eq, value: value.into() }
    }

    #[test]
    fn matching_active_silence_silences() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let s = silence(vec![m("svc", "api")], now - Duration::seconds(1), now + Duration::seconds(60));
        assert!(is_silenced(&labels(&[("svc", "api")]), std::slice::from_ref(&s), now));
    }

    #[test]
    fn non_matching_labels_pass() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let s = silence(vec![m("svc", "api")], now - Duration::seconds(1), now + Duration::seconds(60));
        assert!(!is_silenced(&labels(&[("svc", "web")]), std::slice::from_ref(&s), now));
    }

    #[test]
    fn expired_or_future_silence_does_not_silence() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let expired = silence(vec![m("svc", "api")], now - Duration::seconds(60), now - Duration::seconds(1));
        let future = silence(vec![m("svc", "api")], now + Duration::seconds(1), now + Duration::seconds(60));
        let l = labels(&[("svc", "api")]);
        assert!(!is_silenced(&l, std::slice::from_ref(&expired), now));
        assert!(!is_silenced(&l, std::slice::from_ref(&future), now));
    }

    #[test]
    fn empty_matchers_silence_everything_while_active() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let s = silence(vec![], now - Duration::seconds(1), now + Duration::seconds(60));
        assert!(is_silenced(&labels(&[("svc", "anything")]), std::slice::from_ref(&s), now));
    }
}
```

- [ ] **Step 2: Register the module**

In `crates/dispatcher/src/lib.rs`, add `pub mod silence;` (alphabetical placement — after `routing`, before `slack`):
```rust
pub mod routing;
pub mod silence;
pub mod slack;
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p cc-dispatcher --lib silence`
Expected: PASS.

- [ ] **Step 4: Clippy + commit**

Run: `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/dispatcher/src/silence.rs crates/dispatcher/src/lib.rs
git commit -m "feat(dispatcher): silence filter"
```

---

## Task 6: Inhibition filter (pure)

**Files:**
- Create: `crates/dispatcher/src/inhibition.rs`
- Modify: `crates/dispatcher/src/lib.rs`

- [ ] **Step 1: Write `inhibition.rs` with tests**

Create `crates/dispatcher/src/inhibition.rs`:

```rust
//! Stage 3 of the dispatch pipeline: suppress a target event while a matching source
//! alert is firing. Source/target/`equal` matching uses the synthetic label namespace
//! (user labels + severity/status/rule), so severity-based inhibition works.

use crate::matching::matchers_match;
use cc_domain::ids::InstanceKey;
use cc_domain::inhibition::InhibitionRule;
use std::collections::BTreeMap;

/// `firing` is the source-set: each entry is `(instance_key, synthetic_labels)`.
pub fn is_inhibited(
    ev_labels: &BTreeMap<String, String>,
    ev_key: &InstanceKey,
    rules: &[InhibitionRule],
    firing: &[(InstanceKey, BTreeMap<String, String>)],
) -> bool {
    rules.iter().any(|rule| {
        // Self-inhibition guard: an alert that is itself a source is never inhibited.
        if matchers_match(&rule.source_matchers, ev_labels) {
            return false;
        }
        if !matchers_match(&rule.target_matchers, ev_labels) {
            return false;
        }
        firing.iter().any(|(fkey, flabels)| {
            fkey != ev_key
                && matchers_match(&rule.source_matchers, flabels)
                && rule.equal.iter().all(|l| match (flabels.get(l), ev_labels.get(l)) {
                    (Some(a), Some(b)) => a == b,
                    _ => false, // a label absent on either side is not an equal-match
                })
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::ids::TenantId;
    use cc_domain::routing::{MatchOp, Matcher};
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }
    fn m(label: &str, value: &str) -> Matcher {
        Matcher { label: label.into(), op: MatchOp::Eq, value: value.into() }
    }
    fn rule(source: Vec<Matcher>, target: Vec<Matcher>, equal: &[&str]) -> InhibitionRule {
        InhibitionRule {
            id: Uuid::nil(),
            tenant: TenantId(Uuid::nil()),
            source_matchers: source,
            target_matchers: target,
            equal: equal.iter().map(|s| s.to_string()).collect(),
            created_at: OffsetDateTime::UNIX_EPOCH,
        }
    }
    fn key(s: &str) -> InstanceKey {
        InstanceKey(s.to_string())
    }

    #[test]
    fn firing_source_with_equal_labels_inhibits() {
        let r = rule(vec![m("severity", "critical")], vec![m("severity", "warning")], &["instance"]);
        let target = labels(&[("severity", "warning"), ("instance", "db1")]);
        let firing = vec![(key("src"), labels(&[("severity", "critical"), ("instance", "db1")]))];
        assert!(is_inhibited(&target, &key("tgt"), std::slice::from_ref(&r), &firing));
    }

    #[test]
    fn equal_label_mismatch_does_not_inhibit() {
        let r = rule(vec![m("severity", "critical")], vec![m("severity", "warning")], &["instance"]);
        let target = labels(&[("severity", "warning"), ("instance", "db1")]);
        let firing = vec![(key("src"), labels(&[("severity", "critical"), ("instance", "db2")]))];
        assert!(!is_inhibited(&target, &key("tgt"), std::slice::from_ref(&r), &firing));
    }

    #[test]
    fn equal_label_absent_on_source_does_not_inhibit() {
        let r = rule(vec![m("severity", "critical")], vec![m("severity", "warning")], &["instance"]);
        let target = labels(&[("severity", "warning"), ("instance", "db1")]);
        let firing = vec![(key("src"), labels(&[("severity", "critical")]))]; // no instance label
        assert!(!is_inhibited(&target, &key("tgt"), std::slice::from_ref(&r), &firing));
    }

    #[test]
    fn self_inhibition_guard() {
        // An event that matches the source matchers is never inhibited by that rule.
        let r = rule(vec![m("severity", "critical")], vec![m("severity", "critical")], &[]);
        let target = labels(&[("severity", "critical"), ("instance", "db1")]);
        let firing = vec![(key("src"), labels(&[("severity", "critical"), ("instance", "db1")]))];
        assert!(!is_inhibited(&target, &key("tgt"), std::slice::from_ref(&r), &firing));
    }

    #[test]
    fn own_instance_does_not_inhibit_itself() {
        let r = rule(vec![m("severity", "critical")], vec![m("severity", "warning")], &["instance"]);
        let target = labels(&[("severity", "warning"), ("instance", "db1")]);
        // Only firing entry IS the event's own key — excluded.
        let firing = vec![(key("tgt"), labels(&[("severity", "critical"), ("instance", "db1")]))];
        assert!(!is_inhibited(&target, &key("tgt"), std::slice::from_ref(&r), &firing));
    }

    #[test]
    fn no_firing_source_does_not_inhibit() {
        let r = rule(vec![m("severity", "critical")], vec![m("severity", "warning")], &["instance"]);
        let target = labels(&[("severity", "warning"), ("instance", "db1")]);
        assert!(!is_inhibited(&target, &key("tgt"), std::slice::from_ref(&r), &[]));
    }

    #[test]
    fn target_not_matching_passes() {
        let r = rule(vec![m("severity", "critical")], vec![m("severity", "warning")], &["instance"]);
        let target = labels(&[("severity", "info"), ("instance", "db1")]); // not a warning target
        let firing = vec![(key("src"), labels(&[("severity", "critical"), ("instance", "db1")]))];
        assert!(!is_inhibited(&target, &key("tgt"), std::slice::from_ref(&r), &firing));
    }

    #[test]
    fn inhibition_is_status_agnostic() {
        // A resolving target (status=resolved) is still inhibited if a source fires.
        let r = rule(vec![m("severity", "critical")], vec![m("severity", "warning")], &["instance"]);
        let target = labels(&[("severity", "warning"), ("instance", "db1"), ("status", "resolved")]);
        let firing = vec![(key("src"), labels(&[("severity", "critical"), ("instance", "db1"), ("status", "firing")]))];
        assert!(is_inhibited(&target, &key("tgt"), std::slice::from_ref(&r), &firing));
    }
}
```

- [ ] **Step 2: Register the module**

In `crates/dispatcher/src/lib.rs`, add `pub mod inhibition;` (alphabetical — after `grouping`, before `matching`):
```rust
pub mod grouping;
pub mod inhibition;
pub mod matching;
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p cc-dispatcher --lib inhibition`
Expected: PASS (8 tests).

- [ ] **Step 4: Clippy + commit**

Run: `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/dispatcher/src/inhibition.rs crates/dispatcher/src/lib.rs
git commit -m "feat(dispatcher): inhibition filter with self-inhibition guard"
```

---

## Task 7: Filter cache

**Files:**
- Create: `crates/dispatcher/src/cache.rs`
- Modify: `crates/dispatcher/src/lib.rs`
- Modify: `crates/dispatcher/Cargo.toml`
- Test: `crates/dispatcher/tests/cache_it.rs`

- [ ] **Step 1: Add the `uuid` dependency**

In `crates/dispatcher/Cargo.toml`, under `[dependencies]` (after `hex = "0.4"`), add:
```toml
uuid.workspace = true
```
(`uuid` is currently only a dev-dependency; the cache keys its map by `tenant.0: Uuid`.)

- [ ] **Step 2: Create `cache.rs`**

Create `crates/dispatcher/src/cache.rs`:

```rust
//! Per-replica TTL cache of the per-tenant silence/inhibition/firing data the dispatch
//! filters need. The per-event read path is identical to the eventual pub/sub design;
//! invalidation (a later Phase 3 item) only changes WHEN snapshots refresh.

use crate::routing::synthetic_labels;
use cc_domain::ids::{InstanceKey, TenantId};
use cc_domain::inhibition::InhibitionRule;
use cc_domain::silence::Silence;
use cc_domain::EventStatus;
use cc_stores::{PgStore, StoreError};
use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use uuid::Uuid;

/// Default per-tenant snapshot lifetime.
pub const DEFAULT_TTL: Duration = Duration::from_secs(2);

/// Immutable per-tenant filter inputs, cloned to callers per event.
#[derive(Clone)]
pub struct Snapshot {
    pub silences: Vec<Silence>,
    pub inhibitions: Vec<InhibitionRule>,
    /// Firing source-set as `(instance_key, synthetic_labels)`.
    pub firing: Vec<(InstanceKey, BTreeMap<String, String>)>,
}

struct Entry {
    loaded_at: Instant,
    snap: Snapshot,
}

pub struct FilterCache {
    store: PgStore,
    ttl: Duration,
    entries: RwLock<HashMap<Uuid, Entry>>,
}

impl FilterCache {
    pub fn new(store: PgStore) -> Self {
        Self::with_ttl(store, DEFAULT_TTL)
    }

    pub fn with_ttl(store: PgStore, ttl: Duration) -> Self {
        Self { store, ttl, entries: RwLock::new(HashMap::new()) }
    }

    /// Return a fresh-enough snapshot for `tenant`, reloading from Postgres if the
    /// cached entry is missing or older than the TTL. A concurrent double-reload is
    /// harmless (idempotent reads; last write wins).
    pub async fn snapshot(&self, tenant: TenantId) -> Result<Snapshot, StoreError> {
        {
            let guard = self.entries.read().await;
            if let Some(e) = guard.get(&tenant.0) {
                if e.loaded_at.elapsed() <= self.ttl {
                    return Ok(e.snap.clone());
                }
            }
        }
        let snap = self.load(tenant).await?;
        let mut guard = self.entries.write().await;
        guard.insert(tenant.0, Entry { loaded_at: Instant::now(), snap: snap.clone() });
        Ok(snap)
    }

    async fn load(&self, tenant: TenantId) -> Result<Snapshot, StoreError> {
        let now = time::OffsetDateTime::now_utc();
        let silences = self.store.list_active_silences(tenant, now).await?;
        let inhibitions = self.store.list_inhibitions(tenant).await?;
        let firing = self
            .store
            .list_firing(tenant)
            .await?
            .into_iter()
            .map(|f| {
                let labels = synthetic_labels(&f.labels, f.severity, EventStatus::Firing, f.rule);
                (f.key, labels)
            })
            .collect();
        Ok(Snapshot { silences, inhibitions, firing })
    }
}
```

- [ ] **Step 3: Register the module**

In `crates/dispatcher/src/lib.rs`, add `pub mod cache;` at the top of the module block (alphabetical — before `dedup`):
```rust
pub mod cache;
pub mod dedup;
```

- [ ] **Step 4: Write the failing IT**

Create `crates/dispatcher/tests/cache_it.rs`:

```rust
use cc_dispatcher::cache::FilterCache;
use cc_domain::ids::TenantId;
use cc_domain::routing::{MatchOp, Matcher};
use cc_stores::PgStore;
use std::time::Duration;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

#[tokio::test]
async fn snapshot_caches_within_ttl_and_reloads_after() {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();

    let tenant = TenantId(Uuid::new_v4());
    let now = OffsetDateTime::now_utc();
    let m = vec![Matcher { label: "svc".into(), op: MatchOp::Eq, value: "api".into() }];
    store
        .create_silence(tenant, &m, now - time::Duration::seconds(1), now + time::Duration::hours(1), "", "")
        .await
        .unwrap();

    let cache = FilterCache::with_ttl(store.clone(), Duration::from_millis(150));

    let s1 = cache.snapshot(tenant).await.unwrap();
    assert_eq!(s1.silences.len(), 1);

    // Add a second silence directly; the cached snapshot must NOT see it yet.
    store
        .create_silence(tenant, &m, now - time::Duration::seconds(1), now + time::Duration::hours(1), "", "")
        .await
        .unwrap();
    let s2 = cache.snapshot(tenant).await.unwrap();
    assert_eq!(s2.silences.len(), 1, "served from cache within TTL");

    // After the TTL elapses, the next snapshot reloads and sees both.
    tokio::time::sleep(Duration::from_millis(200)).await;
    let s3 = cache.snapshot(tenant).await.unwrap();
    assert_eq!(s3.silences.len(), 2, "reloaded after TTL");
}
```

- [ ] **Step 5: Run it (fail → pass)**

Run: `cargo test -p cc-dispatcher --test cache_it`
Expected: PASS (Docker required). If it fails to compile first, that confirms the test drives the new API.

- [ ] **Step 6: Clippy + commit**

Run: `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/dispatcher/src/cache.rs crates/dispatcher/src/lib.rs crates/dispatcher/Cargo.toml crates/dispatcher/tests/cache_it.rs
git commit -m "feat(dispatcher): per-tenant TTL filter cache"
```

---

## Task 8: Wire filters into the dispatcher

**Files:**
- Modify: `crates/dispatcher/src/lib.rs`
- Modify: `src/main.rs`
- Modify: `tests/e2e_dispatch.rs`, `tests/e2e_routing.rs`, `tests/e2e_grouping.rs`
- Modify: `crates/dispatcher/tests/dispatch_it.rs`, `crates/dispatcher/tests/routing_dispatch_it.rs`

- [ ] **Step 1: Thread `cache` through `run_dispatcher` and `process_event`**

In `crates/dispatcher/src/lib.rs`:

(a) Add imports near the other `use` lines:
```rust
use crate::cache::FilterCache;
```

(b) Change the `run_dispatcher` signature to add a `cache` parameter (after `groups`):
```rust
pub async fn run_dispatcher(
    consumer: String,
    store: PgStore,
    bus: Arc<dyn EventBus>,
    notifiers: Arc<Notifiers>,
    groups: Arc<dyn GroupStore>,
    cache: Arc<FilterCache>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
```

(c) In the consume loop, pass `cache.as_ref()` into `process_event`:
```rust
        for entry in entries {
            let ack_ok = process_event(
                &store,
                bus.as_ref(),
                notifiers.as_ref(),
                groups.as_ref(),
                cache.as_ref(),
                &entry,
            )
            .await;
```

(d) Change `process_event` to accept the cache and run the filters first. Update its signature:
```rust
async fn process_event(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    groups: &dyn GroupStore,
    cache: &FilterCache,
    entry: &EventEntry,
) -> bool {
    let ev: &Event = &entry.event;

    let labels = routing::match_labels(ev);
    let snap = match cache.snapshot(ev.tenant).await {
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

    let routes = match store.routes_for(ev.tenant).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, entry_id = %entry.id, tenant = ?ev.tenant,
                "loading routes failed; leaving event unacked in PEL for later reclaim");
            return false;
        }
    };

    if routes.is_empty() {
        return firehose_deliver(store, bus, notifiers, ev, &entry.id).await;
    }
    // ... existing receiver/grouping logic continues unchanged ...
```

(e) IMPORTANT: `labels` is now computed at the top. The existing routed branch recomputes `let labels = routing::match_labels(ev);` (around the current line 119) — **delete that duplicate line** so the top-level `labels` is reused. Leave the rest of the routed-branch body (receivers load, `select_grouping_targets`, group buffering) unchanged.

- [ ] **Step 2: Update `main.rs`**

In `src/main.rs`:

(a) Extend the dispatcher import to include `FilterCache`. The current line is:
```rust
use cc_dispatcher::{run_dispatcher, run_group_flusher, Notifiers};
```
Change to:
```rust
use cc_dispatcher::cache::FilterCache;
use cc_dispatcher::{run_dispatcher, run_group_flusher, Notifiers};
```

(b) In the `if run("dispatcher")` block, build the cache once (after `groups` is built, before the `run_dispatcher` spawn) and pass it in. Add:
```rust
        let cache = Arc::new(FilterCache::new(store.clone()));
```
Then update the `run_dispatcher` spawn block to clone and pass `cache`:
```rust
        {
            let store = store.clone();
            let bus = event_bus.clone();
            let notifiers = notifiers.clone();
            let groups = groups.clone();
            let cache = cache.clone();
            let rx = sd_rx.clone();
            let consumer = cfg.node_id.clone();
            handles.push(tokio::spawn(async move {
                run_dispatcher(consumer, store, bus, notifiers, groups, cache, rx).await;
            }));
        }
```
(The `run_group_flusher` spawn is unchanged — the flusher does not re-filter.)

- [ ] **Step 3: Update the 5 test call sites**

Each of these files spawns `run_dispatcher(...)`. In each, build a cache from the test's `store` before the spawn and pass it as the new argument. Add the import `use cc_dispatcher::cache::FilterCache;` to each file.

`tests/e2e_dispatch.rs` (around line 103–112): after the `groups` line, add
```rust
    let cache = Arc::new(FilterCache::new(store.clone()));
```
and change the spawn to:
```rust
        let (store, bus, groups, cache, rx) = (store.clone(), bus.clone(), groups.clone(), cache.clone(), sd_rx.clone());
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifiers, groups, cache, rx).await;
        })
```

Apply the equivalent change in:
- `tests/e2e_routing.rs` (around line 136)
- `tests/e2e_grouping.rs` (around line 123 — note this file already destructures a 5-tuple `(store, bus, groups, notifiers, rx)`; extend it to include `cache`)
- `crates/dispatcher/tests/dispatch_it.rs` (around line 88)
- `crates/dispatcher/tests/routing_dispatch_it.rs` (around line 112)

In each, the literal call must become:
```rust
run_dispatcher("d1".into(), store, bus, notifiers, groups, cache, rx).await;
```
with `let cache = Arc::new(FilterCache::new(store.clone()));` created before the spawn (and cloned into the spawn's move tuple like the other `Arc`s). `Arc` is already imported in these files.

- [ ] **Step 4: Build the whole workspace**

Run: `cargo build --workspace --all-targets`
Expected: compiles. (Fix any missed call site the compiler points to.)

- [ ] **Step 5: Run the full suite**

Run: `cargo test --workspace --no-fail-fast`
Expected: all existing tests still PASS (silence/inhibition with empty rule sets are no-ops, so prior behavior is unchanged), plus the new unit/IT tests.

- [ ] **Step 6: Clippy + commit**

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/dispatcher/src/lib.rs src/main.rs tests/e2e_dispatch.rs tests/e2e_routing.rs tests/e2e_grouping.rs crates/dispatcher/tests/dispatch_it.rs crates/dispatcher/tests/routing_dispatch_it.rs
git commit -m "feat(dispatcher): apply silence and inhibition filters at ingest"
```

---

## Task 9: API endpoints

**Files:**
- Create: `crates/api/src/silences.rs`
- Create: `crates/api/src/inhibitions.rs`
- Modify: `crates/api/src/lib.rs`
- Test: `crates/api/tests/silences_api.rs`

- [ ] **Step 1: Create `silences.rs`**

Create `crates/api/src/silences.rs`:

```rust
use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use cc_domain::routing::Matcher;
use cc_domain::silence::Silence;
use serde::Deserialize;
use serde_json::{json, Value};
use time::OffsetDateTime;
use uuid::Uuid;

fn tenant(state: &AppState, headers: &HeaderMap) -> Result<cc_domain::ids::TenantId, ApiError> {
    state.auth.tenant_from(headers).ok_or(ApiError::Unauthorized)
}

#[derive(Deserialize)]
pub struct CreateSilence {
    pub matchers: Vec<Matcher>,
    #[serde(with = "time::serde::rfc3339")]
    pub starts_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub ends_at: OffsetDateTime,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub author: String,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateSilence>,
) -> Result<Json<Silence>, ApiError> {
    let t = tenant(&state, &headers)?;
    if body.ends_at <= body.starts_at {
        return Err(ApiError::Validation("ends_at must be after starts_at".into()));
    }
    let s = state
        .store
        .create_silence(t, &body.matchers, body.starts_at, body.ends_at, &body.comment, &body.author)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(s))
}

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let silences = state
        .store
        .list_silences(t)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!(silences)))
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state
        .store
        .delete_silence(t, id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if ok {
        Ok(Json(json!({"deleted": true})))
    } else {
        Err(ApiError::NotFound)
    }
}
```

- [ ] **Step 2: Create `inhibitions.rs`**

Create `crates/api/src/inhibitions.rs`:

```rust
use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use cc_domain::inhibition::InhibitionRule;
use cc_domain::routing::Matcher;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

fn tenant(state: &AppState, headers: &HeaderMap) -> Result<cc_domain::ids::TenantId, ApiError> {
    state.auth.tenant_from(headers).ok_or(ApiError::Unauthorized)
}

#[derive(Deserialize)]
pub struct CreateInhibition {
    pub source_matchers: Vec<Matcher>,
    pub target_matchers: Vec<Matcher>,
    #[serde(default)]
    pub equal: Vec<String>,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateInhibition>,
) -> Result<Json<InhibitionRule>, ApiError> {
    let t = tenant(&state, &headers)?;
    let r = state
        .store
        .create_inhibition(t, &body.source_matchers, &body.target_matchers, &body.equal)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(r))
}

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let rules = state
        .store
        .list_inhibitions(t)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!(rules)))
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state
        .store
        .delete_inhibition(t, id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if ok {
        Ok(Json(json!({"deleted": true})))
    } else {
        Err(ApiError::NotFound)
    }
}
```

- [ ] **Step 3: Register modules + routes in `lib.rs`**

In `crates/api/src/lib.rs`, add module decls (alphabetical in the `pub mod` block):
```rust
pub mod alerts;
pub mod auth;
pub mod error;
pub mod inhibitions;
pub mod receivers;
pub mod routes;
pub mod rules;
pub mod silences;
pub mod sse_pump;
pub mod subscriptions;
```
And add routes in `build_router` (after the `/v1/routes` lines, before `.with_state(state)`):
```rust
        .route("/v1/silences", post(silences::create).get(silences::list))
        .route("/v1/silences/:id", axum::routing::delete(silences::delete))
        .route("/v1/inhibitions", post(inhibitions::create).get(inhibitions::list))
        .route("/v1/inhibitions/:id", axum::routing::delete(inhibitions::delete))
```

- [ ] **Step 4: Write the API IT**

Create `crates/api/tests/silences_api.rs`:

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc_api::auth::HeaderAuth;
use cc_api::{build_router, AppState};
use cc_clickhouse::ChClient;
use cc_domain::Event;
use cc_stores::PgStore;
use std::sync::Arc;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use tower::ServiceExt;
use uuid::Uuid;

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn silence_create_list_delete() {
    let pg = Postgres::default().start().await.unwrap();
    let pg_url = format!(
        "postgres://postgres:postgres@127.0.0.1:{}/postgres",
        pg.get_host_port_ipv4(5432).await.unwrap()
    );
    let store = PgStore::connect(&pg_url).await.unwrap();
    store.migrate().await.unwrap();

    let (events_tx, _rx) = tokio::sync::broadcast::channel::<Event>(16);
    let state = AppState {
        store,
        ch: ChClient::new("http://127.0.0.1:1", "default", ""),
        auth: Arc::new(HeaderAuth),
        events_tx,
    };
    let app = build_router(state);
    let tenant = Uuid::new_v4();

    let create = Request::builder()
        .method("POST")
        .uri("/v1/silences")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"matchers":[{"label":"svc","op":"eq","value":"api"}],"starts_at":"2026-06-14T00:00:00Z","ends_at":"2026-06-14T01:00:00Z","comment":"maint","author":"ops"}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["comment"], "maint");

    let list = Request::builder()
        .method("GET")
        .uri("/v1/silences")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(list).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let arr = body_json(resp).await;
    assert_eq!(arr.as_array().unwrap().len(), 1);

    let del = Request::builder()
        .method("DELETE")
        .uri(format!("/v1/silences/{id}"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(del).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Second delete → 404.
    let del2 = Request::builder()
        .method("DELETE")
        .uri(format!("/v1/silences/{id}"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(del2).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
```

- [ ] **Step 5: Run the API IT**

Run: `cargo test -p cc-api --test silences_api`
Expected: PASS (Docker required).

- [ ] **Step 6: Clippy + commit**

Run: `cargo clippy -p cc-api --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/api/src/silences.rs crates/api/src/inhibitions.rs crates/api/src/lib.rs crates/api/tests/silences_api.rs
git commit -m "feat(api): silences and inhibitions CRUD endpoints"
```

---

## Task 10: End-to-end suppression

**Files:**
- Test: `tests/e2e_silences_inhibition.rs`

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e_silences_inhibition.rs`. This drives the full dispatcher via published events (no evaluator), using the no-routes firehose path so each event maps to one webhook unless filtered.

```rust
use cc_dispatcher::cache::FilterCache;
use cc_dispatcher::notify::WebhookNotifier;
use cc_dispatcher::{run_dispatcher, Notifiers};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::instance::{InstanceState, Status};
use cc_domain::rule::{RuleSpec, Severity};
use cc_domain::routing::{MatchOp, Matcher};
use cc_domain::{Event, EventStatus};
use cc_queue::event_bus::RedisEventBus;
use cc_queue::groups::{GroupStore, RedisGroups};
use cc_queue::EventBus;
use cc_stores::PgStore;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

type Captured = Arc<Mutex<Vec<serde_json::Value>>>;

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
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{addr}/hook")
}

fn ev(tenant: TenantId, rule: RuleId, inst: &str, sev: Severity, labels: &[(&str, &str)]) -> Event {
    Event {
        tenant,
        rule,
        instance_key: InstanceKey(inst.into()),
        status: EventStatus::Firing,
        labels: labels.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        value: Some(1.0),
        severity: sev,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

async fn wait_for<F: Fn() -> bool>(pred: F) {
    for _ in 0..100 {
        if pred() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test]
async fn silence_and_inhibition_suppress_delivery() {
    let pg = Postgres::default().start().await.unwrap();
    let pg_url = format!(
        "postgres://postgres:postgres@127.0.0.1:{}/postgres",
        pg.get_host_port_ipv4(5432).await.unwrap()
    );
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!("redis://127.0.0.1:{}", redis.get_host_port_ipv4(6379).await.unwrap());

    let store = PgStore::connect(&pg_url).await.unwrap();
    store.migrate().await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());

    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    let tenant = TenantId(Uuid::new_v4());
    // No routes → firehose path → one webhook per delivered event.
    store.create_subscription(tenant, &hook).await.unwrap();

    // --- silence: drop events with svc=api ---
    let now = OffsetDateTime::now_utc();
    store
        .create_silence(
            tenant,
            &[Matcher { label: "svc".into(), op: MatchOp::Eq, value: "api".into() }],
            now - time::Duration::seconds(5),
            now + time::Duration::hours(1),
            "maint",
            "ops",
        )
        .await
        .unwrap();

    // --- inhibition: critical (svc=db) inhibits warning with equal svc ---
    let spec = RuleSpec {
        sql: "SELECT 1 AS n".into(),
        interval_secs: 1,
        for_secs: 0,
        label_columns: vec![],
        value_column: Some("n".into()),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        resolve_after: 1,
    };
    let src_rule = store.create_rule(tenant, &spec).await.unwrap();
    let mut src_labels = BTreeMap::new();
    src_labels.insert("svc".to_string(), "db".to_string());
    let src_key = InstanceKey::new(src_rule.id, &src_labels);
    let mut firing = InstanceState::new_inactive(src_key.clone(), src_rule.id, tenant, src_labels);
    firing.status = Status::Firing;
    firing.active_since = Some(now);
    store.upsert_instance(&firing).await.unwrap();

    // Inhibition rule: critical inhibits warning when `svc` is equal. Created BEFORE the
    // dispatcher starts so the first per-tenant snapshot already contains it (otherwise a
    // 2s TTL snapshot taken on the first event could miss a later-created rule and the
    // test would flake).
    store
        .create_inhibition(
            tenant,
            &[Matcher { label: "severity".into(), op: MatchOp::Eq, value: "critical".into() }],
            &[Matcher { label: "severity".into(), op: MatchOp::Eq, value: "warning".into() }],
            &["svc".to_string()],
        )
        .await
        .unwrap();

    let cache = Arc::new(FilterCache::new(store.clone()));
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let disp = {
        let (store, bus, groups, cache, rx) =
            (store.clone(), bus.clone(), groups.clone(), cache.clone(), sd_rx.clone());
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifiers, groups, cache, rx).await;
        })
    };

    // 1. Silenced (svc=api) → dropped.
    bus.publish(&ev(tenant, RuleId(Uuid::new_v4()), "i-silenced", Severity::Warning, &[("svc", "api")]))
        .await
        .unwrap();
    // 2. Inhibited (warning, svc=db; a critical svc=db is firing) → dropped.
    bus.publish(&ev(tenant, RuleId(Uuid::new_v4()), "i-inhibited", Severity::Warning, &[("svc", "db")]))
        .await
        .unwrap();
    // 3. Control (svc=web, no silence, no inhibition source) → delivered.
    bus.publish(&ev(tenant, RuleId(Uuid::new_v4()), "i-control", Severity::Warning, &[("svc", "web")]))
        .await
        .unwrap();

    // Wait until the control event is delivered.
    {
        let captured = captured.clone();
        wait_for(move || {
            captured
                .lock()
                .unwrap()
                .iter()
                .any(|d| d["events"][0]["labels"]["svc"] == "web")
        })
        .await;
    }
    // Give any (erroneously) un-suppressed event time to also arrive.
    tokio::time::sleep(Duration::from_millis(300)).await;

    {
        let got = captured.lock().unwrap();
        assert_eq!(got.len(), 1, "only the control event is delivered");
        assert_eq!(got[0]["events"][0]["labels"]["svc"], "web");
    }

    let _ = sd_tx.send(true);
    let _ = disp.await;
}
```

> Note: the firehose webhook payload shape is `{group_key, events: [...]}` (Phase 2c `Notification`), so the assertion reads `d["events"][0]["labels"]["svc"]`. Confirm against `tests/e2e_dispatch.rs`, which asserts the same shape. The inhibition source instance must be `firing` AND its severity (`critical`, from the rule spec) is what the firing-set synthesizes — so the warning event with the same `svc` is inhibited.

- [ ] **Step 2: Run the E2E test**

Run: `cargo test -p cc@0.1.0 --test e2e_silences_inhibition`
Expected: PASS (Docker required).

- [ ] **Step 3: Full suite + clippy**

Run: `cargo test --workspace --no-fail-fast`
Expected: all PASS.

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e_silences_inhibition.rs
git commit -m "test(e2e): silence and inhibition suppress delivery"
```

---

## Final verification

- [ ] `cargo fmt --all -- --check` (or `cargo fmt --all` then re-check) — formatted.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` — clean.
- [ ] `cargo test --workspace --no-fail-fast` — all green (Docker up).
- [ ] No `Co-Authored-By`, "Generated with", or Claude/Anthropic/AI mentions in any commit or code comment.

After all tasks pass and the final holistic review is SHIP, complete via
`superpowers:finishing-a-development-branch`.
