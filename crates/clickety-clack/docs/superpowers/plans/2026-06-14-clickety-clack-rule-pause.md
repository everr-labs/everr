# Rule Pause (freeze semantics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator pause a rule so it stops being evaluated, while preserving the rule and its current alert state and **never** emitting a misleading `Resolved`.

**Architecture:** A `paused BOOLEAN` column on `rules` (operational state, not part of `spec`, so `version` is untouched). The scheduler's two claim queries skip paused rules; the reconciliation sweep skips paused rules' instances (the critical correctness point — otherwise it would synthesize the very `Resolved` we forbid). Two idempotent API sub-actions (`POST /v1/rules/:id/pause` and `/resume`) flip the flag; resume re-arms `next_eval` and resets pending instances' for-duration clock so unobserved pause time can't trigger a spurious fire.

**Tech Stack:** Rust 2021 workspace, `sqlx`/Postgres, `axum`, `testcontainers` (Postgres). Binary package `cc`; crates `cc-domain`, `cc-stores`, `cc-api`.

**Spec:** `docs/superpowers/specs/2026-06-14-clickety-clack-rule-pause.md`. Locked defaults for this plan: pending-instance reset on resume = **on**; API = **two POSTs**; partial index = **included**.

**Conventions (every task):**
- TDD: write the failing test first, watch it fail, implement, watch it pass, commit.
- Integration tests are Docker-backed (testcontainers), named `*_it.rs` in a crate's `tests/`.
- Before committing: run `cargo fmt --all`, then `git status`, and stage every file fmt touched plus any `Cargo.lock` changes.
- Gate per task: relevant tests pass; `cargo clippy -p <crate> --all-targets -- -D warnings` clean.
- **No Claude / AI / Anthropic attribution** anywhere — commits, comments, docs. No `Co-Authored-By`, no "Generated with" footers.

---

## File Structure

**New:**
- `migrations/0007_rule_pause.sql` — add the `paused` column + partial index.
- `crates/stores/tests/rule_pause_it.rs` — store-level integration tests (mutators, claim exclusion, reconciliation exemption).
- `crates/api/tests/rule_pause_api.rs` — HTTP-level tests for pause/resume.

**Modified:**
- `crates/domain/src/rule.rs` — add `paused` to `Rule`.
- `crates/stores/src/pg.rs` — populate `paused` in `Rule` constructors; `AND NOT paused` in both claim queries; `AND NOT r.paused` in `list_stale_instances`; new `pause_rule`/`resume_rule`.
- `crates/api/src/rules.rs` — `pause`/`resume` handlers.
- `crates/api/src/lib.rs` — two new routes.
- `docs/how-to/write-alert-rules.md`, `docs/how-to/suppress-with-silences-and-inhibitions.md`, `docs/reference/http-api.md`, `docs/reference/data-model.md`, `docs/reference/storage-and-keys.md` — document pause.

---

## Task 1: Schema + `Rule.paused` field, threaded through the store

**Files:**
- Create: `migrations/0007_rule_pause.sql`
- Modify: `crates/domain/src/rule.rs`
- Modify: `crates/stores/src/pg.rs` (`create_rule`, `get_rule`, `claim_due_rules`, `claim_due_rules_sharded`)

- [ ] **Step 1: Write the migration**

Create `migrations/0007_rule_pause.sql`:
```sql
-- Operational pause flag for rules. Default false preserves existing behavior.
ALTER TABLE rules ADD COLUMN paused BOOLEAN NOT NULL DEFAULT false;

-- Keep the scheduler's due-rule scan lean now that it also filters on `paused`.
CREATE INDEX rules_next_eval_active_idx ON rules (next_eval) WHERE NOT paused;
```

- [ ] **Step 2: Write the failing domain test**

Append to the test module at the bottom of `crates/domain/src/rule.rs` (create a `#[cfg(test)] mod tests { ... }` if none exists):
```rust
#[cfg(test)]
mod pause_tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn rule_paused_defaults_false_when_absent() {
        // Older serialized rules have no `paused`; it must default to false.
        let v = serde_json::json!({
            "id": Uuid::nil(),
            "tenant": Uuid::nil(),
            "spec": {
                "sql": "SELECT 1",
                "interval_secs": 30,
                "for_secs": 0,
                "label_columns": [],
                "severity": "info"
            },
            "version": 1
        });
        let r: Rule = serde_json::from_value(v).unwrap();
        assert!(!r.paused);
    }
}
```
(`serde_json` and `uuid` are already dependencies of `cc-domain`; confirm with `grep -E 'serde_json|uuid' crates/domain/Cargo.toml` and add under `[dev-dependencies]` if missing.)

- [ ] **Step 3: Run to confirm failure**

Run: `cargo test -p cc-domain rule_paused_defaults_false_when_absent`
Expected: FAIL to compile — `Rule` has no field `paused`.

- [ ] **Step 4: Add the field**

In `crates/domain/src/rule.rs`, add the field to `Rule`:
```rust
/// A persisted rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    pub id: RuleId,
    pub tenant: TenantId,
    pub spec: RuleSpec,
    pub version: i64,
    /// Operational pause flag. Not part of the spec; does not affect `version`.
    #[serde(default)]
    pub paused: bool,
}
```

- [ ] **Step 5: Run the domain test (passes), then fix store call sites**

Run: `cargo test -p cc-domain rule_paused_defaults_false_when_absent` → PASS.

Run: `cargo build -p cc-stores 2>&1 | head -30`
Expected: FAIL — every `Rule { … }` construction in `crates/stores/src/pg.rs` is missing `paused`.

In `crates/stores/src/pg.rs` update the four constructors:

`create_rule` — a freshly created rule is active:
```rust
        Ok(Rule {
            id: RuleId(id),
            tenant,
            spec: spec.clone(),
            version: 1,
            paused: false,
        })
```

`get_rule` — select and read the column. Change the query and the struct:
```rust
        let row = sqlx::query("SELECT spec, version, paused FROM rules WHERE id=$1 AND tenant=$2")
```
```rust
                Ok(Some(Rule {
                    id,
                    tenant,
                    spec,
                    version: r.get("version"),
                    paused: r.get("paused"),
                }))
```

`claim_due_rules` and `claim_due_rules_sharded` — add `r.paused` to each `RETURNING` clause:
```sql
             RETURNING r.id, r.tenant, r.spec, r.version, r.paused
```
and in each row-mapping loop set:
```rust
            out.push(Rule {
                id: RuleId(r.get("id")),
                tenant: TenantId(r.get("tenant")),
                spec,
                version: r.get("version"),
                paused: r.get("paused"),
            });
```

- [ ] **Step 6: Catch any other `Rule { … }` literal**

Run: `grep -rn "Rule {" crates src tests | grep -v "RuleSpec\|RuleId"`
Fix any remaining literal construction (likely in tests/e2e that build a `Rule` by hand) by adding `paused: false`. Most code builds rules via `create_rule`, so there may be none.

- [ ] **Step 7: Compile the workspace**

Run: `cargo build --workspace 2>&1 | tail -20`
Expected: compiles.

- [ ] **Step 8: Commit**

```bash
cargo fmt --all
git add migrations/0007_rule_pause.sql crates/domain/src/rule.rs crates/stores/src/pg.rs
git commit -m "Add paused column and Rule.paused field"
```

---

## Task 2: `pause_rule` / `resume_rule` store mutators

**Files:**
- Modify: `crates/stores/src/pg.rs`
- Create: `crates/stores/tests/rule_pause_it.rs`

- [ ] **Step 1: Write the failing integration test**

Create `crates/stores/tests/rule_pause_it.rs`:
```rust
use cc_domain::ids::{RuleId, TenantId};
use cc_domain::rule::{RuleSpec, Severity};
use cc_stores::PgStore;
use std::collections::BTreeMap;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use uuid::Uuid;

async fn store() -> PgStore {
    let pg = Postgres::default().start().await.unwrap();
    let url = format!(
        "postgres://postgres:postgres@127.0.0.1:{}/postgres",
        pg.get_host_port_ipv4(5432).await.unwrap()
    );
    // Leak the container so it outlives the test body (matches other store tests).
    std::mem::forget(pg);
    let s = PgStore::connect(&url).await.unwrap();
    s.migrate().await.unwrap();
    s
}

fn spec() -> RuleSpec {
    RuleSpec {
        sql: "SELECT host FROM t".into(),
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec!["host".into()],
        value_column: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
    }
}

#[tokio::test]
async fn pause_and_resume_toggle_flag() {
    let s = store().await;
    let tenant = TenantId(Uuid::new_v4());
    let rule = s.create_rule(tenant, &spec()).await.unwrap();
    assert!(!rule.paused);

    assert!(s.pause_rule(tenant, rule.id).await.unwrap());
    assert!(s.get_rule(tenant, rule.id).await.unwrap().unwrap().paused);

    // Idempotent: pausing again still succeeds.
    assert!(s.pause_rule(tenant, rule.id).await.unwrap());

    assert!(s.resume_rule(tenant, rule.id).await.unwrap());
    assert!(!s.get_rule(tenant, rule.id).await.unwrap().unwrap().paused);
}

#[tokio::test]
async fn pause_missing_or_wrong_tenant_returns_false() {
    let s = store().await;
    let tenant = TenantId(Uuid::new_v4());
    let rule = s.create_rule(tenant, &spec()).await.unwrap();

    assert!(!s.pause_rule(tenant, RuleId(Uuid::new_v4())).await.unwrap());
    assert!(!s.pause_rule(TenantId(Uuid::new_v4()), rule.id).await.unwrap());
    assert!(!s.resume_rule(tenant, RuleId(Uuid::new_v4())).await.unwrap());
}
```

Note: if other store tests bind the container to a variable kept alive for the test instead of `std::mem::forget`, match that pattern — open `crates/stores/tests/routing_it.rs` and copy whichever it uses. (The connection URL/migrate lines are identical either way.)

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p cc-stores --test rule_pause_it pause_and_resume_toggle_flag`
Expected: FAIL to compile — `pause_rule`/`resume_rule` don't exist.

- [ ] **Step 3: Implement the mutators**

In `crates/stores/src/pg.rs`, add near the other rule methods:
```rust
    /// Pause a rule (exclude it from evaluation). Idempotent. Returns false if no
    /// such rule exists for the tenant.
    pub async fn pause_rule(&self, tenant: TenantId, id: RuleId) -> Result<bool, StoreError> {
        let res = sqlx::query(
            "UPDATE rules SET paused = true, updated_at = now() WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.0)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    /// Resume a paused rule: clear the flag, re-arm `next_eval` so it evaluates
    /// promptly, and restart the for-duration / resolve counters for its pending
    /// instances so unobserved pause time can't trigger a spurious fire. Firing
    /// instances are left untouched (frozen → real resolve only when truly clear).
    /// Idempotent. Returns false if no such rule exists for the tenant.
    pub async fn resume_rule(&self, tenant: TenantId, id: RuleId) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        let res = sqlx::query(
            "UPDATE rules SET paused = false, next_eval = now(), updated_at = now()
             WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.0)
        .execute(&mut *tx)
        .await?;
        if res.rows_affected() == 0 {
            tx.rollback().await?;
            return Ok(false);
        }
        sqlx::query(
            "UPDATE instances SET active_since = NULL, absent_count = 0
             WHERE rule=$1 AND status='pending'",
        )
        .bind(id.0)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p cc-stores --test rule_pause_it`
Expected: `pause_and_resume_toggle_flag` and `pause_missing_or_wrong_tenant_returns_false` pass.

- [ ] **Step 5: Add the pending-reset test**

Append to `crates/stores/tests/rule_pause_it.rs`:
```rust
#[tokio::test]
async fn resume_resets_pending_instances() {
    let s = store().await;
    let tenant = TenantId(Uuid::new_v4());
    let rule = s.create_rule(tenant, &spec()).await.unwrap();

    // Insert a pending instance with a stale active_since and a nonzero absent_count.
    sqlx::query(
        "INSERT INTO instances (key, rule, tenant, status, labels, value, active_since, last_seen, absent_count)
         VALUES ('k1', $1, $2, 'pending', '{}'::jsonb, NULL, now() - interval '1 hour', now() - interval '1 hour', 2)",
    )
    .bind(rule.id.0)
    .bind(tenant.0)
    .execute(s.pool_for_test())
    .await
    .unwrap();

    s.pause_rule(tenant, rule.id).await.unwrap();
    s.resume_rule(tenant, rule.id).await.unwrap();

    let (active_since, absent): (Option<time::OffsetDateTime>, i32) =
        sqlx::query_as("SELECT active_since, absent_count FROM instances WHERE key='k1'")
            .fetch_one(s.pool_for_test())
            .await
            .unwrap();
    assert!(active_since.is_none(), "for-duration clock was reset");
    assert_eq!(absent, 0, "absent_count was reset");
}
```
This needs a test accessor for the pool. In `crates/stores/src/pg.rs` add (guarded so it isn't part of the public prod surface):
```rust
    /// Test-only access to the underlying pool for raw setup/assertions.
    #[doc(hidden)]
    pub fn pool_for_test(&self) -> &sqlx::PgPool {
        &self.pool
    }
```
(`sqlx` with the `time` feature is already a dep; `time` is a workspace dep — add `time` under `crates/stores/Cargo.toml` `[dev-dependencies]` if the test doesn't compile.)

- [ ] **Step 6: Run to confirm pass**

Run: `cargo test -p cc-stores --test rule_pause_it`
Expected: all three tests pass.

- [ ] **Step 7: Commit**

```bash
cargo fmt --all
git add crates/stores/src/pg.rs crates/stores/tests/rule_pause_it.rs
git commit -m "Add pause_rule/resume_rule store mutators with pending-instance reset"
```

---

## Task 3: Scheduler skips paused rules

**Files:**
- Modify: `crates/stores/src/pg.rs` (`claim_due_rules`, `claim_due_rules_sharded`)
- Modify: `crates/stores/tests/rule_pause_it.rs`

- [ ] **Step 1: Write the failing test**

Append to `crates/stores/tests/rule_pause_it.rs`:
```rust
#[tokio::test]
async fn paused_rules_are_not_claimed() {
    let s = store().await;
    let tenant = TenantId(Uuid::new_v4());
    let active = s.create_rule(tenant, &spec()).await.unwrap();
    let paused = s.create_rule(tenant, &spec()).await.unwrap();
    s.pause_rule(tenant, paused.id).await.unwrap();

    let now = time::OffsetDateTime::now_utc();

    // Non-sharded claim: only the active rule is returned.
    let claimed = s.claim_due_rules(now, 100).await.unwrap();
    let ids: Vec<_> = claimed.iter().map(|r| r.id).collect();
    assert!(ids.contains(&active.id));
    assert!(!ids.contains(&paused.id), "paused rule must not be claimed");

    // Reset next_eval so the sharded claim sees both as due again.
    sqlx::query("UPDATE rules SET next_eval = now() WHERE tenant=$1")
        .bind(tenant.0)
        .execute(s.pool_for_test())
        .await
        .unwrap();

    // Sharded claim with shard_count=1, owned=[0] owns every tenant.
    let claimed = s.claim_due_rules_sharded(now, 100, &[0], 1).await.unwrap();
    let ids: Vec<_> = claimed.iter().map(|r| r.id).collect();
    assert!(ids.contains(&active.id));
    assert!(!ids.contains(&paused.id), "paused rule must not be claimed (sharded)");
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p cc-stores --test rule_pause_it paused_rules_are_not_claimed`
Expected: FAIL — the paused rule is still claimed.

- [ ] **Step 3: Add the predicate to both claim queries**

In `crates/stores/src/pg.rs`, in `claim_due_rules` change the `due` CTE:
```sql
                SELECT id FROM rules WHERE next_eval <= $1 AND NOT paused
                ORDER BY next_eval LIMIT $2 FOR UPDATE SKIP LOCKED
```
In `claim_due_rules_sharded` change the `due` CTE:
```sql
                SELECT id FROM rules
                WHERE next_eval <= $1 AND NOT paused
                  AND (((hashtext(tenant::text)::bigint % $3) + $3) % $3)::int = ANY($4)
                ORDER BY next_eval LIMIT $2 FOR UPDATE SKIP LOCKED
```

- [ ] **Step 4: Run to confirm pass**

Run: `cargo test -p cc-stores --test rule_pause_it paused_rules_are_not_claimed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/stores/src/pg.rs crates/stores/tests/rule_pause_it.rs
git commit -m "Exclude paused rules from scheduler claim queries"
```

---

## Task 4: Reconciliation exempts paused rules (core correctness guard)

**Files:**
- Modify: `crates/stores/src/pg.rs` (`list_stale_instances`)
- Modify: `crates/stores/tests/rule_pause_it.rs`

- [ ] **Step 1: Write the failing test**

Append to `crates/stores/tests/rule_pause_it.rs`:
```rust
#[tokio::test]
async fn paused_rules_firing_instances_are_not_reconciled() {
    let s = store().await;
    let tenant = TenantId(Uuid::new_v4());
    let rule = s.create_rule(tenant, &spec()).await.unwrap(); // interval_secs=30 → stale after 60s

    // A firing instance last seen an hour ago is stale by the max(4*interval,60s) rule.
    sqlx::query(
        "INSERT INTO instances (key, rule, tenant, status, labels, value, active_since, last_seen, absent_count)
         VALUES ('stale1', $1, $2, 'firing', '{}'::jsonb, NULL, now() - interval '2 hours', now() - interval '1 hour', 0)",
    )
    .bind(rule.id.0)
    .bind(tenant.0)
    .execute(s.pool_for_test())
    .await
    .unwrap();

    let now = time::OffsetDateTime::now_utc();

    // Active rule: the stale firing instance is reconcilable.
    let stale = s.list_stale_instances(now).await.unwrap();
    assert!(stale.iter().any(|i| i.key.0 == "stale1"));

    // Pause the rule: it must drop out of the reconciliation set, so the
    // maintenance sweep cannot synthesize a (misleading) Resolved.
    s.pause_rule(tenant, rule.id).await.unwrap();
    let stale = s.list_stale_instances(now).await.unwrap();
    assert!(!stale.iter().any(|i| i.key.0 == "stale1"),
        "paused rule's firing instance must NOT be auto-resolved");
}
```
(Confirm the `StaleInstance` field is `key` of type `InstanceKey` with a public `.0`; it is, per `crates/domain/src/...` `StaleInstance`. If the key field name differs, match it.)

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p cc-stores --test rule_pause_it paused_rules_firing_instances_are_not_reconciled`
Expected: FAIL on the second assertion — the paused rule's instance is still returned.

- [ ] **Step 3: Add the exemption**

In `crates/stores/src/pg.rs`, in `list_stale_instances`, add `AND NOT r.paused` to the WHERE:
```sql
             FROM instances i JOIN rules r ON r.id = i.rule
             WHERE i.status IN ('pending','firing')
               AND NOT r.paused
               AND i.last_seen < ($1::timestamptz
                   - make_interval(secs => GREATEST(4 * (r.spec->>'interval_secs')::int, 60)))
```

- [ ] **Step 4: Run to confirm pass**

Run: `cargo test -p cc-stores --test rule_pause_it`
Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/stores/src/pg.rs crates/stores/tests/rule_pause_it.rs
git commit -m "Exempt paused rules from stale-instance reconciliation"
```

---

## Task 5: API endpoints `POST /v1/rules/:id/pause` and `/resume`

**Files:**
- Modify: `crates/api/src/rules.rs`
- Modify: `crates/api/src/lib.rs`
- Create: `crates/api/tests/rule_pause_api.rs`

- [ ] **Step 1: Write the failing HTTP test**

Create `crates/api/tests/rule_pause_api.rs` (mirrors `crates/api/tests/routing_api.rs`):
```rust
use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc_api::auth::HeaderAuth;
use cc_api::{build_router, AppState};
use cc_clickhouse::ChClient;
use cc_crypto::EnvKeyring;
use cc_domain::Event;
use cc_stores::PgStore;
use std::collections::HashMap;
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
async fn pause_then_resume_round_trip() {
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
        cipher: Arc::new(
            EnvKeyring::new(HashMap::from([("v1".to_string(), [7u8; 32])]), "v1".to_string()).unwrap(),
        ),
        events_tx,
    };
    let app = build_router(state);
    let tenant = Uuid::new_v4();

    // Create a rule.
    let create = Request::builder()
        .method("POST").uri("/v1/rules")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
        )).unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();

    // Pause → 200, paused=true.
    let pause = Request::builder()
        .method("POST").uri(format!("/v1/rules/{id}/pause"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty()).unwrap();
    let resp = app.clone().oneshot(pause).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await["paused"], true);

    // Resume → 200, paused=false.
    let resume = Request::builder()
        .method("POST").uri(format!("/v1/rules/{id}/resume"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty()).unwrap();
    let resp = app.clone().oneshot(resume).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await["paused"], false);

    // Pause an unknown id → 404.
    let missing = Request::builder()
        .method("POST").uri(format!("/v1/rules/{}/pause", Uuid::new_v4()))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty()).unwrap();
    let resp = app.clone().oneshot(missing).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p cc-api --test rule_pause_api`
Expected: FAIL — routes return 404/405 (handlers + routes not wired).

- [ ] **Step 3: Add the handlers**

In `crates/api/src/rules.rs`, add after `delete`:
```rust
pub async fn pause(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Rule>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state
        .store
        .pause_rule(t, RuleId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if !ok {
        return Err(ApiError::NotFound);
    }
    state
        .store
        .get_rule(t, RuleId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

pub async fn resume(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Rule>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state
        .store
        .resume_rule(t, RuleId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if !ok {
        return Err(ApiError::NotFound);
    }
    state
        .store
        .get_rule(t, RuleId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .map(Json)
        .ok_or(ApiError::NotFound)
}
```

- [ ] **Step 4: Wire the routes**

In `crates/api/src/lib.rs`, after the `/v1/rules/:id/test` route, add:
```rust
        .route("/v1/rules/:id/pause", post(rules::pause))
        .route("/v1/rules/:id/resume", post(rules::resume))
```
(`post` is already imported — it's used by the existing rules routes.)

- [ ] **Step 5: Run to confirm pass**

Run: `cargo test -p cc-api --test rule_pause_api`
Expected: PASS.

- [ ] **Step 6: Clippy + commit**

Run: `cargo clippy -p cc-api -p cc-stores --all-targets -- -D warnings`
Expected: clean.
```bash
cargo fmt --all
git add crates/api/src/rules.rs crates/api/src/lib.rs crates/api/tests/rule_pause_api.rs
git commit -m "Add pause/resume rule HTTP endpoints"
```

---

## Task 6: Documentation + full workspace gate

**Files:**
- Modify: `docs/how-to/write-alert-rules.md`, `docs/how-to/suppress-with-silences-and-inhibitions.md`
- Modify: `docs/reference/http-api.md`, `docs/reference/data-model.md`, `docs/reference/storage-and-keys.md`

- [ ] **Step 1: Document the endpoints (reference)**

In `docs/reference/http-api.md`, in the Rules table, add two rows:
```markdown
| `POST /v1/rules/:id/pause`  | Pause evaluation. Freezes state, emits no events. Returns the updated `Rule`. Idempotent; unknown id → `404`. |
| `POST /v1/rules/:id/resume` | Resume evaluation. Re-arms scheduling and restarts pending instances' for-duration. Returns the updated `Rule`. |
```
And add a sentence under the Rule response noting the `paused` boolean field.

- [ ] **Step 2: Document the field (data model)**

In `docs/reference/data-model.md`, in the Rule "stored as" note, change it to include `paused`:
> Stored as a `Rule`: `{ id, tenant, spec, version, paused }` where `paused` is an
> operational flag (not part of `spec`, does not affect `version`).

- [ ] **Step 3: Document the column + migration (storage)**

In `docs/reference/storage-and-keys.md`, in the `rules` table row add `paused` to the key columns, and add a migrations-table row:
```markdown
| `0007_rule_pause.sql`         | Adds `paused` to `rules` (+ partial index on `next_eval WHERE NOT paused`). |
```

- [ ] **Step 4: Add the how-to + pause-vs-silence note**

In `docs/how-to/write-alert-rules.md`, add a section:
```markdown
## Pause a rule

To stop evaluating a rule without deleting it (maintenance, triage, cost):

```bash
curl -s -X POST localhost:8080/v1/rules/$RULE_ID/pause   -H "X-CC-Tenant: $TENANT"
curl -s -X POST localhost:8080/v1/rules/$RULE_ID/resume  -H "X-CC-Tenant: $TENANT"
```

Pause **freezes** state: evaluation (and the ClickHouse query) stops, currently
firing instances stay firing, and **no `Resolved` is emitted** — so on-call is not
told "all clear" for an unfixed problem. On resume, evaluation restarts and a real
`Resolved` fires only if the condition has actually cleared; pending instances
restart their for-duration clock.

> **Pause vs. silence.** Pause stops the *work* (no evaluation, no events).
> A [silence](suppress-with-silences-and-inhibitions.md) keeps evaluating and only
> mutes *notifications*. Use pause to stop a rule; use a silence to stay evaluating
> but go quiet.
```

In `docs/how-to/suppress-with-silences-and-inhibitions.md`, add one line near the top contrasting with pause and linking to the section above.

- [ ] **Step 5: Full workspace gate**

Run: `cargo fmt --all -- --check`  → clean (else `cargo fmt --all` and re-stage).
Run: `cargo clippy --all-targets -- -D warnings`  → clean.
Run: `cargo test --workspace --no-fail-fast`  → all green, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add docs Cargo.lock
git commit -m "Document rule pause: how-to, API, data model, storage"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- `paused` column on `rules`, not in spec, no `version` bump → Task 1 (column) + mutators leave `version` untouched (Task 2). ✓
- Scheduler excludes paused (both claim queries) → Task 3. ✓
- Reconciliation exemption (the core correctness decision) → Task 4, with the explicit regression test asserting no stale-resolve. ✓
- `pause_rule`/`resume_rule`, idempotent, tenant-scoped, `404` on missing → Task 2 + Task 5. ✓
- Resume re-arms `next_eval` and resets pending instances' `active_since`/`absent_count` (locked default = on) → Task 2 (`resume_rule`) + test in Task 2 Step 5. ✓
- API: two POST sub-actions returning updated `Rule` → Task 5. ✓
- Partial index (locked default = included) → Task 1 Step 1. ✓
- Docs (how-to, API, data model, storage, pause-vs-silence) → Task 6. ✓
- Out-of-scope items (bulk pause, timed auto-resume, `/v1/alerts` paused flag, auto-pause-on-error) → not implemented, as specified. ✓

**2. Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" — every code step shows complete code. Two soft notes (the container-lifetime pattern in Task 2 Step 1, and confirming `StaleInstance.key` in Task 4 Step 1) point at concrete in-repo references to copy, not unspecified work.

**3. Type consistency:** `Rule.paused: bool`; `pause_rule(tenant: TenantId, id: RuleId) -> Result<bool, StoreError>` and `resume_rule(...)` identical shape; `pool_for_test()`; handlers `rules::pause`/`rules::resume`; routes `/v1/rules/:id/pause` and `/resume`. `RuleSpec` fields used in the test fixture match `crates/domain/src/rule.rs` exactly (sql, interval_secs, for_secs, label_columns, value_column, severity, annotations, resolve_after). ✓
