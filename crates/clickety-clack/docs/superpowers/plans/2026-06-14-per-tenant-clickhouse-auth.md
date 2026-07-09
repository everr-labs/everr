# Per-Tenant ClickHouse Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate to ClickHouse with per-tenant credentials behind a pluggable provider seam, keeping the single-shared-user default and staying generic.

**Architecture:** A `ChAuthProvider` trait resolves per-tenant ClickHouse auth; `ChClient` consults it per request. Three built-in providers (`shared`/`derived`/`map`) are selected by config and built fail-closed at startup. `TenantId` becomes a validated string so tenant identity can be everr's org id (or anything). Query coalescing is keyed by the resolved auth identity so cross-tenant queries never share a round-trip.

**Tech Stack:** Rust, reqwest, async-trait, sqlx/Postgres, hmac/sha2/hex, serde_json, testcontainers.

**Spec:** `docs/superpowers/specs/2026-06-14-per-tenant-clickhouse-auth-design.md`. Spec B (rule health / degraded state) is out of scope — see `2026-06-14-rule-health-degraded-state-NOTES.md`.

**Crate names:** binary `cc`; libs `cc-domain`, `cc-clickhouse`, `cc-evaluator`, `cc-api`, `cc-stores`, `cc-sqlguard`, `cc-crypto`. Build with `cargo build`; per-crate tests with `cargo test -p <crate>`.

---

## File Structure

- `crates/domain/src/ids.rs` — `TenantId(String)` + `parse`/`from_trusted`/`as_str` + `InvalidTenantId`.
- `crates/clickhouse/src/auth.rs` *(new)* — `ChAuth`, `AuthIdentity`, `ChAuthProvider`, `SharedAuth`/`DerivedAuth`/`MapAuth`, `build_ch_auth`, `ChAuthError`.
- `crates/clickhouse/src/lib.rs` — `ChClient` holds the provider; `query_rows(tenant, …)`; `RowQuerier` gains `tenant` + `auth_identity`.
- `crates/clickhouse/Cargo.toml` — add `cc-domain`, `hmac`, `sha2`, `hex`, `serde`.
- `crates/sqlguard/src/lib.rs` — add `resource_limit_settings_no_readonly()`.
- `src/config.rs` — five new `CC_CH_*` vars.
- `src/main.rs` — build provider fail-closed; inject into `ChClient`.
- `crates/evaluator/src/lib.rs` — thread tenant; identity-keyed `QuerySig`.
- `crates/evaluator/tests/coalescing_it.rs` — update `CountingCh`; add cross-tenant cases.
- `crates/api/src/rules.rs` — thread tenant into `/test`.
- `crates/stores/src/pg.rs` — `.bind(tenant.as_str())`, `TenantId::from_trusted(...)`.
- `migrations/*.sql` — `tenant UUID` → `tenant TEXT` in place.
- `crates/clickhouse/tests/derived_auth_it.rs` *(new)* — testcontainers per-tenant auth proof.
- Docs: `docs/reference/configuration.md`, `docs/how-to/harden-clickhouse-access.md`.

---

## Task 1: `TenantId` → validated string (+ migrations in place)

Foundational, atomic: the type change won't compile until every site is updated. Inner field becomes **private**, forcing the validating constructor at the boundary.

**Files:**
- Modify: `crates/domain/src/ids.rs`
- Modify: `crates/stores/src/pg.rs` (binds + decodes)
- Modify: `crates/api/src/auth.rs:14-17` (header parse)
- Modify: `migrations/0001_init.sql`, `migrations/0002_notifications.sql`, `migrations/0003_routing.sql`, `migrations/0005_silences_inhibitions.sql`, `migrations/0006_event_outbox.sql`
- Modify: all test files constructing `TenantId(...)` (~80 sites)

- [ ] **Step 1: Write the failing parse test**

In `crates/domain/src/ids.rs`, add to the `tests` module:

```rust
#[test]
fn tenant_parse_accepts_valid() {
    assert!(TenantId::parse("org42").is_ok());
    assert!(TenantId::parse("00000000-0000-0000-0000-000000000000").is_ok());
    assert!(TenantId::parse("a_b.c-D9").is_ok());
    assert!(TenantId::parse(&"x".repeat(64)).is_ok());
}

#[test]
fn tenant_parse_rejects_invalid() {
    assert_eq!(TenantId::parse(""), Err(InvalidTenantId));
    assert_eq!(TenantId::parse(&"x".repeat(65)), Err(InvalidTenantId));
    for bad in ["has space", "quote'", "semi;colon", "slash/x", "café", "a\nb"] {
        assert_eq!(TenantId::parse(bad), Err(InvalidTenantId), "{bad:?}");
    }
}
```

- [ ] **Step 2: Run it — expect FAIL (type still `Uuid`, no `parse`)**

Run: `cargo test -p cc-domain tenant_parse`
Expected: FAIL to compile (`parse`/`InvalidTenantId` not found).

- [ ] **Step 3: Replace the type definition**

In `crates/domain/src/ids.rs`, replace the `TenantId` definition (line 6) and add the error + impls. Keep `RuleId` as-is.

```rust
#[derive(Debug, PartialEq, Eq)]
pub struct InvalidTenantId;

impl std::fmt::Display for InvalidTenantId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("invalid tenant id: must match ^[A-Za-z0-9_.-]{1,64}$")
    }
}
impl std::error::Error for InvalidTenantId {}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TenantId(String);

impl TenantId {
    /// Parse + validate untrusted input (e.g. the X-CC-Tenant header). Accepts
    /// `^[A-Za-z0-9_.-]{1,64}$` — safe interpolated into a ClickHouse username, a
    /// Redis key, or hashed for grouping.
    pub fn parse(s: &str) -> Result<Self, InvalidTenantId> {
        let ok = (1..=64).contains(&s.len())
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
        if ok {
            Ok(TenantId(s.to_string()))
        } else {
            Err(InvalidTenantId)
        }
    }

    /// Wrap a value already validated on write / read from trusted storage.
    pub fn from_trusted(s: impl Into<String>) -> Self {
        TenantId(s.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for TenantId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
```

- [ ] **Step 4: Run the parse test — expect PASS**

Run: `cargo test -p cc-domain tenant_parse`
Expected: PASS. (The rest of the workspace does NOT compile yet — that's fixed below.)

- [ ] **Step 5: Fix the store binds and decodes**

In `crates/stores/src/pg.rs`: replace every `.bind(tenant.0)` with `.bind(tenant.as_str())` (and any `.bind(<x>.tenant.0)` similarly with `.as_str()`). Replace every decode `TenantId(r.get("tenant"))` with `TenantId::from_trusted(r.get::<String, _>("tenant"))`. The sharding expression `hashtext(tenant::text)` (≈ line 266) is unchanged. Where the borrow checker reports `tenant` used after move (now non-`Copy`), add `.clone()` at the reuse site.

- [ ] **Step 6: Fix the header parse**

In `crates/api/src/auth.rs:14-17`:

```rust
pub fn tenant_from(&self, headers: &HeaderMap) -> Option<TenantId> {
    let raw = headers.get("X-CC-Tenant")?.to_str().ok()?;
    TenantId::parse(raw).ok()
}
```

Remove the now-unused `use uuid::Uuid;` if present in that file.

- [ ] **Step 7: Edit migrations in place**

Run `grep -rni "tenant uuid" migrations/` to list them, then in each of `0001_init.sql`, `0002_notifications.sql`, `0003_routing.sql`, `0005_silences_inhibitions.sql`, `0006_event_outbox.sql` change `tenant UUID NOT NULL` to `tenant TEXT NOT NULL`. Leave all index definitions unchanged. Verify none remain: `grep -rni "tenant uuid" migrations/` returns nothing.

- [ ] **Step 8: Mechanically fix all `TenantId(...)` construction sites**

Apply across the whole workspace (production + tests):
- `TenantId(Uuid::new_v4())` → `TenantId::from_trusted(Uuid::new_v4().to_string())`
- `TenantId(Uuid::nil())` → `TenantId::from_trusted(Uuid::nil().to_string())`
- Any `tenant.0` (e.g. `tenant.0.as_bytes()` in `crates/dispatcher/src/grouping.rs`) → `tenant.as_str()` / `tenant.as_str().as_bytes()`.
- The remaining ~12 sites such as `TenantId(meta.tenant)` / `TenantId(job.tenant)`: if the source is already a `TenantId`, drop the wrapper; if it is a `String`/`Uuid`, use `TenantId::from_trusted(<x>.to_string())`. Let the compiler enumerate them.
- Add `.clone()` where a now-non-`Copy` `TenantId` is used more than once (e.g. `crates/stores/tests/inhibitions_it.rs` passes `tenant` to four store calls — clone for the first three).

- [ ] **Step 9: Build the whole workspace green**

Run: `cargo build --workspace --all-targets`
Expected: compiles. Fix remaining move/borrow errors with `.as_str()`/`.clone()` as the compiler directs.

- [ ] **Step 10: Run the full test suite**

Run: `cargo test --workspace`
Expected: PASS (integration tests needing Docker may be skipped/ignored as before).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Make TenantId a validated string and switch tenant columns to TEXT"
```

---

## Task 2: ClickHouse auth types + `shared` provider

Additive — new module, nothing else consumes it yet.

**Files:**
- Create: `crates/clickhouse/src/auth.rs`
- Modify: `crates/clickhouse/src/lib.rs` (add `mod auth; pub use auth::*;`)
- Modify: `crates/clickhouse/Cargo.toml`

- [ ] **Step 1: Add dependencies**

In `crates/clickhouse/Cargo.toml` `[dependencies]`, add (match versions used in `crates/crypto/Cargo.toml` and `crates/domain/Cargo.toml`):

```toml
cc-domain = { path = "../domain" }
hmac = "0.12"
sha2 = "0.10"
hex = "0.4"
serde = { version = "1", features = ["derive"] }
```

- [ ] **Step 2: Write the failing `shared` provider test**

Create `crates/clickhouse/src/auth.rs` with only the test first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::ids::TenantId;

    fn t(s: &str) -> TenantId {
        TenantId::from_trusted(s)
    }

    #[test]
    fn shared_ignores_tenant_and_keeps_app_limits() {
        let p = SharedAuth {
            user: "default".into(),
            password: "pw".into(),
        };
        let a = p.resolve(&t("anything"));
        assert_eq!(a.user, "default");
        assert_eq!(a.key, "pw");
        assert!(a.quota.is_none());
        assert!(!a.server_enforced_limits);
        assert!(a.extra_settings.is_empty());
        // Same identity for any tenant ⇒ coalescing preserved.
        assert_eq!(p.auth_identity_of(&t("x")), p.auth_identity_of(&t("y")));
    }
}
```

- [ ] **Step 3: Run it — expect FAIL (types undefined)**

Run: `cargo test -p cc-clickhouse shared_ignores`
Expected: FAIL to compile.

- [ ] **Step 4: Implement the types + `shared` provider**

At the top of `crates/clickhouse/src/auth.rs` (above the test module):

```rust
use cc_domain::ids::TenantId;

/// Per-request ClickHouse auth context.
pub struct ChAuth {
    pub user: String,
    pub key: String,
    /// Reserved for future RLS-via-setting providers; empty for shared/derived/map.
    pub extra_settings: Vec<(String, String)>,
    pub quota: Option<String>,
    /// True ⇒ the CH user/profile already pins readonly + caps, so the client omits
    /// its own `readonly=1` (avoids "Cannot modify setting in readonly mode").
    pub server_enforced_limits: bool,
}

/// What distinguishes two queries' result sets for coalescing: the auth user plus any
/// sorted extra settings. Equal identity ⇒ safe to share one ClickHouse round-trip.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct AuthIdentity {
    pub user: String,
    pub settings: Vec<(String, String)>,
}

/// Resolves the ClickHouse auth context for one tenant's query.
pub trait ChAuthProvider: Send + Sync {
    fn resolve(&self, tenant: &TenantId) -> ChAuth;

    /// Coalescing key derived from `resolve`. Default impl is correct for all providers.
    fn auth_identity_of(&self, tenant: &TenantId) -> AuthIdentity {
        let a = self.resolve(tenant);
        let mut settings = a.extra_settings;
        settings.sort();
        AuthIdentity {
            user: a.user,
            settings,
        }
    }
}

/// Single shared user — reproduces the pre-feature behavior exactly.
pub struct SharedAuth {
    pub user: String,
    pub password: String,
}

impl ChAuthProvider for SharedAuth {
    fn resolve(&self, _tenant: &TenantId) -> ChAuth {
        ChAuth {
            user: self.user.clone(),
            key: self.password.clone(),
            extra_settings: Vec::new(),
            quota: None,
            server_enforced_limits: false,
        }
    }
}
```

In `crates/clickhouse/src/lib.rs`, add near the top:

```rust
mod auth;
pub use auth::*;
```

- [ ] **Step 5: Run it — expect PASS**

Run: `cargo test -p cc-clickhouse shared_ignores`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/clickhouse/src/auth.rs crates/clickhouse/src/lib.rs crates/clickhouse/Cargo.toml
git commit -m "Add ClickHouse auth provider trait and shared provider"
```

---

## Task 3: `derived` + `map` providers and the fail-closed factory

**Files:**
- Modify: `crates/clickhouse/src/auth.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `crates/clickhouse/src/auth.rs`:

```rust
// RFC 4231 HMAC-SHA-256 Test Case 1: key = 0x0b*20, data = "Hi There".
#[test]
fn derive_password_matches_rfc4231_vector() {
    let key = [0x0bu8; 20];
    let got = derive_password(&key, "Hi There", "");
    assert_eq!(
        got,
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    );
}

#[test]
fn derived_templates_user_and_suffixes_password() {
    let p = DerivedAuth {
        user_template: "sql_api_org_{tenant}".into(),
        master_key: b"masterkey".to_vec(),
        suffix: "A!".into(),
    };
    let a = p.resolve(&t("org42"));
    assert_eq!(a.user, "sql_api_org_org42");
    assert!(a.key.ends_with("A!"));
    assert_eq!(a.quota.as_deref(), Some("sql_api_org_org42"));
    assert!(a.server_enforced_limits);
    // Deterministic, and distinct tenants ⇒ distinct identity (no cross-tenant coalescing).
    assert_eq!(p.resolve(&t("org42")).key, p.resolve(&t("org42")).key);
    assert_ne!(p.auth_identity_of(&t("a")), p.auth_identity_of(&t("b")));
}

#[test]
fn map_resolves_known_tenant() {
    let p = build_ch_auth(
        "map",
        "",
        "",
        None,
        None,
        "",
        Some(r#"{"t1":{"user":"u1","password":"p1"}}"#),
    )
    .unwrap();
    let a = p.resolve(&t("t1"));
    assert_eq!((a.user.as_str(), a.key.as_str()), ("u1", "p1"));
    assert!(a.server_enforced_limits);
}

#[test]
fn factory_fails_closed() {
    assert!(build_ch_auth("derived", "", "", Some("sql_api_org_{tenant}"), None, "", None).is_err());
    assert!(build_ch_auth("derived", "", "", None, Some("k"), "", None).is_err());
    assert!(build_ch_auth("map", "", "", None, None, "", Some("{}")).is_err());
    assert!(build_ch_auth("map", "", "", None, None, "", None).is_err());
    assert!(build_ch_auth("bogus", "", "", None, None, "", None).is_err());
    assert!(build_ch_auth("shared", "default", "", None, None, "", None).is_ok());
}
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `cargo test -p cc-clickhouse -- derive_ derived_ map_resolves factory_fails`
Expected: FAIL to compile.

- [ ] **Step 3: Implement derived, map, and the factory**

Add to `crates/clickhouse/src/auth.rs` (above the tests):

```rust
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ChAuthError {
    #[error("clickhouse auth config: {0}")]
    Config(String),
}

/// HMAC-SHA256(master_key, tenant) as lowercase hex, with `suffix` appended.
pub(crate) fn derive_password(master_key: &[u8], tenant: &str, suffix: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac =
        <Hmac<Sha256>>::new_from_slice(master_key).expect("HMAC accepts any key length");
    mac.update(tenant.as_bytes());
    let digest = mac.finalize().into_bytes();
    format!("{}{}", hex::encode(digest), suffix)
}

/// Per-tenant credentials derived from a shared master key (everr-compatible).
pub struct DerivedAuth {
    pub user_template: String,
    pub master_key: Vec<u8>,
    pub suffix: String,
}

impl ChAuthProvider for DerivedAuth {
    fn resolve(&self, tenant: &TenantId) -> ChAuth {
        let user = self.user_template.replace("{tenant}", tenant.as_str());
        let key = derive_password(&self.master_key, tenant.as_str(), &self.suffix);
        ChAuth {
            user: user.clone(),
            key,
            extra_settings: Vec::new(),
            quota: Some(user),
            server_enforced_limits: true,
        }
    }
}

#[derive(serde::Deserialize)]
pub(crate) struct MapEntry {
    user: String,
    password: String,
}

/// Explicit tenant → credential map.
pub struct MapAuth {
    entries: HashMap<String, MapEntry>,
}

impl ChAuthProvider for MapAuth {
    fn resolve(&self, tenant: &TenantId) -> ChAuth {
        match self.entries.get(tenant.as_str()) {
            Some(e) => ChAuth {
                user: e.user.clone(),
                key: e.password.clone(),
                extra_settings: Vec::new(),
                quota: Some(e.user.clone()),
                server_enforced_limits: true,
            },
            // Unknown tenant ⇒ deliberately invalid creds; the query fails with an auth
            // error (surfaced as an eval error). A rule-create preflight (future) catches
            // it earlier.
            None => ChAuth {
                user: String::new(),
                key: String::new(),
                extra_settings: Vec::new(),
                quota: None,
                server_enforced_limits: true,
            },
        }
    }
}

/// Build the auth provider from config, failing closed on misconfiguration. Built before
/// any role logic so a broken config is a loud startup error, mirroring `build_cipher`.
pub fn build_ch_auth(
    mode: &str,
    ch_user: &str,
    ch_password: &str,
    user_template: Option<&str>,
    master_key: Option<&str>,
    password_suffix: &str,
    tenant_map: Option<&str>,
) -> Result<Arc<dyn ChAuthProvider>, ChAuthError> {
    match mode {
        "shared" => Ok(Arc::new(SharedAuth {
            user: ch_user.to_string(),
            password: ch_password.to_string(),
        })),
        "derived" => {
            let template = user_template.filter(|s| !s.is_empty()).ok_or_else(|| {
                ChAuthError::Config("CC_CH_USER_TEMPLATE required for derived mode".into())
            })?;
            let key = master_key.filter(|s| !s.is_empty()).ok_or_else(|| {
                ChAuthError::Config("CC_CH_MASTER_KEY required for derived mode".into())
            })?;
            Ok(Arc::new(DerivedAuth {
                user_template: template.to_string(),
                master_key: key.as_bytes().to_vec(),
                suffix: password_suffix.to_string(),
            }))
        }
        "map" => {
            let raw = tenant_map.ok_or_else(|| {
                ChAuthError::Config("CC_CH_TENANT_MAP required for map mode".into())
            })?;
            let json = if raw.trim_start().starts_with('{') {
                raw.to_string()
            } else {
                std::fs::read_to_string(raw).map_err(|e| {
                    ChAuthError::Config(format!("reading CC_CH_TENANT_MAP file: {e}"))
                })?
            };
            let entries: HashMap<String, MapEntry> = serde_json::from_str(&json)
                .map_err(|e| ChAuthError::Config(format!("parsing CC_CH_TENANT_MAP: {e}")))?;
            if entries.is_empty() {
                return Err(ChAuthError::Config("CC_CH_TENANT_MAP is empty".into()));
            }
            Ok(Arc::new(MapAuth { entries }))
        }
        other => Err(ChAuthError::Config(format!(
            "unknown CC_CH_AUTH_MODE '{other}'"
        ))),
    }
}
```

`thiserror` and `serde_json` are already dependencies of `cc-clickhouse` (used by `ChError`/row parsing); `serde` derive was added in Task 2.

- [ ] **Step 4: Run the tests — expect PASS**

Run: `cargo test -p cc-clickhouse`
Expected: PASS (all auth tests green).

- [ ] **Step 5: Commit**

```bash
git add crates/clickhouse/src/auth.rs
git commit -m "Add derived and map ClickHouse auth providers with fail-closed factory"
```

---

## Task 4: Config — the five `CC_CH_*` variables

Additive — fields unused until Task 6.

**Files:**
- Modify: `src/config.rs`

- [ ] **Step 1: Add fields to `Config`**

In `src/config.rs`, add to the `Config` struct (after `ch_password`):

```rust
    pub ch_auth_mode: String,
    pub ch_user_template: Option<String>,
    pub ch_master_key: Option<String>,
    pub ch_password_suffix: String,
    pub ch_tenant_map: Option<String>,
```

- [ ] **Step 2: Populate them in `from_env`**

In the `Config { … }` literal in `from_env`, after `ch_password: …,`:

```rust
            ch_auth_mode: var("CC_CH_AUTH_MODE", "shared"),
            ch_user_template: env::var("CC_CH_USER_TEMPLATE").ok(),
            ch_master_key: env::var("CC_CH_MASTER_KEY").ok(),
            ch_password_suffix: var("CC_CH_PASSWORD_SUFFIX", ""),
            ch_tenant_map: env::var("CC_CH_TENANT_MAP").ok(),
```

- [ ] **Step 3: Build green**

Run: `cargo build -p cc`
Expected: compiles (fields unused warnings are acceptable for now; they are consumed in Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/config.rs
git commit -m "Add CC_CH_AUTH_MODE and per-tenant ClickHouse auth config vars"
```

---

## Task 5: Thread `tenant` through the `query_rows` seam

Atomic trait-signature change. `ChClient` still holds `user`/`password` and ignores `tenant` here — provider injection is Task 6. This isolates the wide signature churn from the behavior change.

**Files:**
- Modify: `crates/clickhouse/src/lib.rs` (inherent + trait + impl)
- Modify: `crates/evaluator/src/lib.rs:113-118`
- Modify: `crates/api/src/rules.rs:134-145`
- Modify: `crates/evaluator/tests/coalescing_it.rs:25-34`

- [ ] **Step 1: Add `tenant` to the inherent and trait methods**

In `crates/clickhouse/src/lib.rs`, add `use cc_domain::ids::TenantId;` near the top. Change the inherent `ChClient::query_rows` signature (line 46) to take the tenant first; the body is unchanged for now:

```rust
    pub async fn query_rows(
        &self,
        _tenant: &TenantId,
        sql: &str,
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
```

Change the `RowQuerier` trait (line 92):

```rust
#[async_trait]
pub trait RowQuerier: Send + Sync {
    async fn query_rows(
        &self,
        tenant: &TenantId,
        sql: &str,
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError>;
}
```

Change the impl (line 102):

```rust
#[async_trait]
impl RowQuerier for ChClient {
    async fn query_rows(
        &self,
        tenant: &TenantId,
        sql: &str,
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        ChClient::query_rows(self, tenant, sql, label_columns, value_column).await
    }
}
```

- [ ] **Step 2: Update the evaluator call site**

In `crates/evaluator/src/lib.rs`, the query call (≈ line 113) passes the group's representative tenant:

```rust
        let rows = match ch
            .query_rows(
                &sample.tenant,
                &sample.spec.sql,
                &sample.spec.label_columns,
                sample.spec.value_column.as_deref(),
            )
            .await
```

`sample` is `&members[0].1` (a `&Rule`). Confirm the rule carries `tenant`; if the field lives on the job rather than the rule, use `&members[0].0.tenant` instead. Pick whichever is the `TenantId` in scope.

- [ ] **Step 3: Update the API `/test` handler**

In `crates/api/src/rules.rs`, replace the unused binding and pass the tenant:

```rust
    let t = tenant(&state, &headers)?;
    validate_spec(&spec)?;
    let rows = state
        .ch
        .query_rows(&t, &spec.sql, &spec.label_columns, spec.value_column.as_deref())
        .await
        .map_err(|e| ApiError::Validation(format!("query failed: {e}")))?;
```

- [ ] **Step 4: Update the `CountingCh` test double**

In `crates/evaluator/tests/coalescing_it.rs`, add `use cc_domain::ids::TenantId;` if absent, and update the impl:

```rust
#[async_trait]
impl RowQuerier for CountingCh {
    async fn query_rows(
        &self,
        _tenant: &TenantId,
        _sql: &str,
        _label_columns: &[String],
        _value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.rows.clone())
    }
}
```

- [ ] **Step 5: Build + test green**

Run: `cargo build --workspace --all-targets && cargo test -p cc-clickhouse -p cc-evaluator -p cc-api`
Expected: PASS. The existing coalescing test still passes (tenant ignored).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Thread tenant through the RowQuerier query seam"
```

---

## Task 6: Inject the provider into `ChClient` + readonly suppression + `auth_identity`

Now `ChClient` resolves per-tenant auth. Adds the sqlguard no-readonly settings and the `auth_identity` trait method.

**Files:**
- Modify: `crates/sqlguard/src/lib.rs`
- Modify: `crates/clickhouse/src/lib.rs`
- Modify: `crates/evaluator/tests/coalescing_it.rs` (impl `auth_identity` on the double)
- Modify: `src/main.rs`

- [ ] **Step 1: Add the no-readonly settings to sqlguard (failing test first)**

In `crates/sqlguard/src/lib.rs` tests:

```rust
    #[test]
    fn no_readonly_settings_drop_readonly_only() {
        let s = resource_limit_settings_no_readonly();
        assert!(s.contains("max_execution_time=10"));
        assert!(s.contains("max_memory_usage=2000000000"));
        assert!(!s.contains("readonly"));
    }
```

Run: `cargo test -p cc-sqlguard no_readonly` → FAIL (undefined). Then add:

```rust
/// Same cost caps as [`resource_limit_settings`] but without `readonly=1`, for CH users
/// whose profile already pins readonly (sending it again errors "Cannot modify setting in
/// readonly mode").
pub fn resource_limit_settings_no_readonly() -> &'static str {
    "max_execution_time=10, max_rows_to_read=50000000, max_memory_usage=2000000000"
}
```

Run: `cargo test -p cc-sqlguard no_readonly` → PASS.

- [ ] **Step 2: Swap `ChClient` to hold a provider**

In `crates/clickhouse/src/lib.rs`, change the struct (lines 15-21) and `new` (lines 30-42):

```rust
use std::sync::Arc;

#[derive(Clone)]
pub struct ChClient {
    http: reqwest::Client,
    base_url: String,
    auth: Arc<dyn ChAuthProvider>,
}

impl ChClient {
    pub fn new(base_url: impl Into<String>, auth: Arc<dyn ChAuthProvider>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into(),
            auth,
        }
    }
```

- [ ] **Step 3: Use resolved auth in `query_rows`**

Replace the request-building portion of the inherent `query_rows` (the `settings`/`resp` block, lines 52-63) with:

```rust
        let auth = self.auth.resolve(_tenant);
        let mut settings = if auth.server_enforced_limits {
            cc_sqlguard::resource_limit_settings_no_readonly().to_string()
        } else {
            cc_sqlguard::resource_limit_settings().to_string()
        };
        for (k, v) in &auth.extra_settings {
            settings.push_str(&format!(", {k}={v}"));
        }
        let wrapped = format!("{sql} FORMAT JSONEachRow");
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
```

Rename the param from `_tenant` to `tenant` (it is now used). Remove the now-duplicated `let wrapped = …;` line that preceded the block.

- [ ] **Step 4: Add `auth_identity` to the trait + impl**

In `crates/clickhouse/src/lib.rs`, add to the `RowQuerier` trait (a sync method):

```rust
    /// Coalescing identity for `tenant` — equal identity ⇒ shareable round-trip.
    fn auth_identity(&self, tenant: &TenantId) -> AuthIdentity;
```

And to `impl RowQuerier for ChClient`:

```rust
    fn auth_identity(&self, tenant: &TenantId) -> AuthIdentity {
        self.auth.auth_identity_of(tenant)
    }
```

- [ ] **Step 5: Implement `auth_identity` on the test double**

In `crates/evaluator/tests/coalescing_it.rs`, add to `impl RowQuerier for CountingCh` (per-tenant identity so the double can model both shared and per-tenant coalescing):

```rust
    fn auth_identity(&self, tenant: &TenantId) -> cc_clickhouse::AuthIdentity {
        cc_clickhouse::AuthIdentity {
            user: tenant.as_str().to_string(),
            settings: Vec::new(),
        }
    }
```

- [ ] **Step 6: Build the provider in `main.rs` and inject it**

In `src/main.rs`, replace line 45:

```rust
    let ch_auth = cc_clickhouse::build_ch_auth(
        &cfg.ch_auth_mode,
        &cfg.ch_user,
        &cfg.ch_password,
        cfg.ch_user_template.as_deref(),
        cfg.ch_master_key.as_deref(),
        &cfg.ch_password_suffix,
        cfg.ch_tenant_map.as_deref(),
    )?;
    let ch = ChClient::new(&cfg.ch_url, ch_auth);
```

This sits right after the `cipher` is built (both fail-closed before role logic).

- [ ] **Step 7: Build + test green**

Run: `cargo build --workspace --all-targets && cargo test -p cc-clickhouse -p cc-sqlguard`
Expected: PASS. (The `coalescing_it.rs` cross-tenant assertions come in Task 7; existing same-signature test still passes if its jobs share a tenant — verified there.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Resolve per-tenant ClickHouse auth in ChClient and inject the provider"
```

---

## Task 7: Identity-keyed coalescing in the evaluator

`QuerySig` gains the resolved `AuthIdentity` so identical SQL across different tenants no longer shares a ClickHouse round-trip (closing the cross-tenant row-sharing bug), while `shared` mode keeps full coalescing.

**Files:**
- Modify: `crates/evaluator/src/lib.rs:15-32,101-108`
- Modify: `crates/evaluator/tests/coalescing_it.rs`

- [ ] **Step 1: Add the identity field to `QuerySig`**

In `crates/evaluator/src/lib.rs`, change `QuerySig` and its constructor:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct QuerySig {
    auth: cc_clickhouse::AuthIdentity,
    sql: String,
    label_columns: Vec<String>,
    value_column: Option<String>,
}

impl QuerySig {
    fn of(auth: cc_clickhouse::AuthIdentity, spec: &RuleSpec) -> Self {
        Self {
            auth,
            sql: spec.sql.clone(),
            label_columns: spec.label_columns.clone(),
            value_column: spec.value_column.clone(),
        }
    }
}
```

- [ ] **Step 2: Key groups by resolved identity**

In `process_batch`, the grouping loop (≈ lines 102-108) resolves auth per job:

```rust
    let mut groups: HashMap<QuerySig, Vec<(cc_queue::EvalJob, Rule)>> = HashMap::new();
    for (job, rule) in resolved {
        let auth = ch.auth_identity(&job.tenant);
        groups
            .entry(QuerySig::of(auth, &rule.spec))
            .or_default()
            .push((job, rule));
    }
```

Update the two in-module unit tests (`identical_specs_share_signature`, `differing_fields_separate_signatures`) to pass an `AuthIdentity` to `QuerySig::of`, e.g. a helper:

```rust
    fn ident(user: &str) -> cc_clickhouse::AuthIdentity {
        cc_clickhouse::AuthIdentity { user: user.into(), settings: Vec::new() }
    }
```

so `QuerySig::of(ident("u"), &spec(...))`; add an assertion that a differing `auth` separates signatures:

```rust
    assert_ne!(
        QuerySig::of(ident("a"), &spec("SELECT 1", &["a"], Some("v"))),
        QuerySig::of(ident("b"), &spec("SELECT 1", &["a"], Some("v"))),
    );
```

- [ ] **Step 3: Reconcile + extend the integration coalescing test**

In `crates/evaluator/tests/coalescing_it.rs`: the existing "identical signature ⇒ one query" test must use the **same tenant** for its coalesced jobs (the double's `auth_identity` is per-tenant). Inspect the test; if it already uses one tenant, it passes unchanged. Add two cases:

```rust
// Same SQL, SAME tenant ⇒ coalesced into one ClickHouse round-trip.
// Same SQL, DIFFERENT tenants ⇒ two round-trips (per-tenant isolation).
```

Implement the second as: enqueue two jobs with identical specs but distinct tenants (`TenantId::from_trusted("ta")`, `TenantId::from_trusted("tb")`), run `process_batch`, assert `counting.calls == 2`. For the shared-coalescing case, two jobs with the same tenant assert `calls == 1`.

- [ ] **Step 4: Build + test green**

Run: `cargo test -p cc-evaluator`
Expected: PASS, including the new cross-tenant separation case.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Key evaluator query coalescing by resolved tenant auth identity"
```

---

## Task 8: Integration test — derived-mode per-tenant auth reaches ClickHouse over the wire

**Revised from the original plan:** the codebase has no real ClickHouse container (testcontainers-modules only enables postgres/redis; existing tests fake CH with an in-process `stub_clickhouse()` axum server — see `tests/e2e_dispatch.rs:36`). So rather than introduce a brand-new CH container with SQL-driven access control, this test uses a **header-capturing axum stub** to assert the per-tenant wire contract: templated username + HMAC password + quota header + readonly suppression. (Cross-tenant ROW isolation via RLS is operator/ClickHouse config and out of scope — this proves clickety-clack *sends the right per-tenant credentials and settings*.) Docker-free and consistent with the existing stub idiom.

**Files:**
- Create: `crates/clickhouse/tests/derived_auth_it.rs`
- Modify: `crates/clickhouse/src/auth.rs` (add the test helper below)
- Modify: `crates/clickhouse/Cargo.toml` (`[dev-dependencies]`: add `axum` — use `axum.workspace = true`; `tokio` is already a dev-dep; `serde_json` is already a normal dep)

- [ ] **Step 1: Expose the derivation to the test** — add to `crates/clickhouse/src/auth.rs`:

```rust
/// Test-only accessor for the password derivation (keeps `derive_password` crate-private).
#[doc(hidden)]
pub fn derived_password_for_test(master_key: &[u8], tenant: &str, suffix: &str) -> String {
    derive_password(master_key, tenant, suffix)
}
```

- [ ] **Step 2: Write the header-capturing test**

Create `crates/clickhouse/tests/derived_auth_it.rs`. A capturing stub records the headers of the next request; then derived- and shared-mode `ChClient`s query it and we assert what reached the wire:

```rust
use cc_clickhouse::{build_ch_auth, ChClient};
use cc_domain::ids::TenantId;
use std::sync::{Arc, Mutex};

#[derive(Default, Clone)]
struct Captured {
    user: Option<String>,
    key: Option<String>,
    quota: Option<String>,
    settings: Option<String>,
}

/// Start an in-process stub that records the next request's CH auth headers and returns
/// one JSONEachRow row. Returns (base_url, captured-handle).
async fn capturing_stub() -> (String, Arc<Mutex<Captured>>) {
    use axum::http::HeaderMap;
    use axum::routing::post;
    use axum::Router;
    let cap = Arc::new(Mutex::new(Captured::default()));
    let cap2 = cap.clone();
    let app = Router::new().route(
        "/",
        post(move |headers: HeaderMap| {
            let cap = cap2.clone();
            async move {
                let g = |k: &str| {
                    headers
                        .get(k)
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string())
                };
                *cap.lock().unwrap() = Captured {
                    user: g("x-clickhouse-user"),
                    key: g("x-clickhouse-key"),
                    quota: g("x-clickhouse-quota"),
                    settings: g("x-clickhouse-settings"),
                };
                "{\"u\":\"ok\"}\n".to_string()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    (format!("http://{addr}/"), cap)
}

#[tokio::test]
async fn derived_mode_sends_per_tenant_credentials_and_suppresses_readonly() {
    let (url, cap) = capturing_stub().await;
    let auth = build_ch_auth(
        "derived", "", "",
        Some("sql_api_org_{tenant}"), Some("masterkey"), "A!", None,
    )
    .unwrap();
    let ch = ChClient::new(url, auth);

    ch.query_rows(
        &TenantId::from_trusted("ta"),
        "SELECT u",
        &["u".to_string()],
        None,
    )
    .await
    .unwrap();

    let c = cap.lock().unwrap().clone();
    assert_eq!(c.user.as_deref(), Some("sql_api_org_ta"));
    assert_eq!(c.quota.as_deref(), Some("sql_api_org_ta"));
    let expected_pw = cc_clickhouse::derived_password_for_test(b"masterkey", "ta", "A!");
    assert_eq!(c.key.as_deref(), Some(expected_pw.as_str()));
    // server_enforced_limits ⇒ no readonly in the settings header.
    assert!(!c.settings.unwrap_or_default().contains("readonly"));
}

#[tokio::test]
async fn shared_mode_is_unchanged_on_the_wire() {
    let (url, cap) = capturing_stub().await;
    let auth = build_ch_auth("shared", "default", "", None, None, "", None).unwrap();
    let ch = ChClient::new(url, auth);

    ch.query_rows(
        &TenantId::from_trusted("anything"),
        "SELECT u",
        &["u".to_string()],
        None,
    )
    .await
    .unwrap();

    let c = cap.lock().unwrap().clone();
    assert_eq!(c.user.as_deref(), Some("default"));
    assert_eq!(c.quota, None); // no quota header in shared mode
    assert!(c.settings.unwrap_or_default().contains("readonly=1"));
}
```

- [ ] **Step 3: Run it (no Docker needed)**

Run: `cargo test -p cc-clickhouse --test derived_auth_it`
Expected: both tests PASS. Pure in-process HTTP; no containers.

- [ ] **Step 3: Commit**

```bash
git add crates/clickhouse/tests/derived_auth_it.rs crates/clickhouse/src/auth.rs crates/clickhouse/Cargo.toml
git commit -m "Add integration test proving derived per-tenant ClickHouse auth"
```

---

## Task 9: Documentation

**Files:**
- Modify: `docs/reference/configuration.md`
- Modify: `docs/how-to/harden-clickhouse-access.md`

- [ ] **Step 1: Document the new variables**

In `docs/reference/configuration.md`, in the datastores/ClickHouse section, add `CC_CH_AUTH_MODE` (`shared` default | `derived` | `map`), `CC_CH_USER_TEMPLATE` (e.g. `sql_api_org_{tenant}`), `CC_CH_MASTER_KEY` (required for `derived`; a crown-jewel secret — store in a secret manager), `CC_CH_PASSWORD_SUFFIX` (default empty; everr uses `A!`), and `CC_CH_TENANT_MAP` (inline JSON or file path for `map`). State that `derived`/`map` are built fail-closed at startup.

- [ ] **Step 2: Cross-reference from the hardening guide**

In `docs/how-to/harden-clickhouse-access.md`, add a short section noting that `CC_CH_AUTH_MODE=derived` (or `map`) makes a **per-tenant least-privilege user** the automatic auth model — each tenant authenticates as its own CH user, so the least-privilege grants + row policies in this guide become the per-tenant isolation boundary. clickety-clack authenticates but does not provision these users.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/configuration.md docs/how-to/harden-clickhouse-access.md
git commit -m "Document per-tenant ClickHouse auth configuration"
```

---

## Final review

After all tasks: dispatch a final code reviewer over the whole branch, then run `cargo fmt --all`, `cargo clippy --workspace --all-targets`, and `cargo test --workspace`. Confirm: `shared` mode is byte-for-byte unchanged (default behavior), `derived` reproduces everr's username/password, cross-tenant coalescing is gone in per-tenant modes and preserved in `shared`, and no derived password can reach a log line. Then use superpowers:finishing-a-development-branch.
