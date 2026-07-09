# Pluggable Per-Tenant ClickHouse Auth — Design

**Status: approved (2026-06-14).** Ready for implementation planning.

**Goal:** Let clickety-clack authenticate to ClickHouse with per-tenant credentials —
compatible with everr's per-org user model — behind a pluggable seam that keeps the
single-shared-user default and stays generic for other deployments.

**Scope:** This is **Spec A**. Rule health / degraded-state notifications are **Spec B**
(`2026-06-14-rule-health-degraded-state-NOTES.md`). The two touch only where
result-row truncation causes an evaluation error; everything here stands alone.

---

## Motivation

Today clickety-clack builds **one** `ChClient` at startup from `CC_CH_USER` /
`CC_CH_PASSWORD` and shares it across all tenants; `query_rows` has no tenant parameter
(`src/main.rs:45`, `crates/clickhouse/src/lib.rs`). Worse, the evaluator coalesces
identical rule SQL **across tenants** (`QuerySig` has no tenant —
`crates/evaluator/src/lib.rs:18`), so two tenants with the same query share one
ClickHouse round-trip and the same rows. Against a multi-tenant ClickHouse with
row-level security (everr's model), that is both unauthorized (wrong credentials) and
incorrect (cross-tenant row mixing).

everr gives each org a dedicated ClickHouse user `sql_api_org_<org>` with password
`HMAC-SHA256(CLICKHOUSE_SQL_API_MASTER_KEY, org)` hex + `"A!"` (deterministic, never
stored), authenticates **per request** via HTTP Basic auth, and isolates tenants with
per-org row policies under a least-privilege role/profile. clickety-clack should be able
to adopt that model without baking everr specifics into a tool meant to be generic.

## Design principles

- **One seam for the deployment-specific concern.** Only two things are
  deployment-specific: how a tenant maps to ClickHouse credentials, and whether the
  server enforces isolation/limits. Put exactly those behind a trait; ship built-ins.
- **Backwards compatible by default.** The `shared` provider reproduces today's behavior
  byte-for-byte; existing single-tenant deployments notice nothing.
- **Generic, not everr-shaped.** everr is reproduced via *config* (`derived` provider),
  not hardcoded. Anyone using the common "derive a per-tenant password from a master key"
  pattern is covered; `map` covers the rest.
- **clickety-clack authenticates; it does not provision.** Creating CH users, roles, row
  policies, and profiles is operator/everr responsibility. The
  [harden-the-ClickHouse-user how-to](../../how-to/harden-clickhouse-access.md) is the
  contract.
- **Fail closed.** Misconfiguration is a loud startup failure, never a silent fallback.

---

## Component 1 — The `ChAuthProvider` seam

A trait the `ChClient` consults per query. The rest of the engine is untouched — it still
sees the `RowQuerier` trait.

```rust
/// Resolves the ClickHouse auth context for one tenant's query.
pub trait ChAuthProvider: Send + Sync {
    fn resolve(&self, tenant: &TenantId) -> ChAuth;
}

/// The per-request auth context applied to a ClickHouse HTTP call.
pub struct ChAuth {
    pub user: String,
    pub key: String,                            // password
    /// Reserved for future RLS-via-setting providers. Empty for shared/derived/map.
    pub extra_settings: Vec<(String, String)>,
    pub quota: Option<String>,                  // X-ClickHouse-Quota value, if any
    /// When true, the CH user/profile already pins readonly + cost caps, so the client
    /// MUST NOT send its own `readonly=1` (avoids "Cannot modify setting in readonly
    /// mode"). It MAY still send the MAX-bounded cost caps.
    pub server_enforced_limits: bool,
}
```

**`ChClient` changes** (`crates/clickhouse/src/lib.rs`):
- Drop the baked `user` / `password` fields; hold `auth: Arc<dyn ChAuthProvider>`.
- `query_rows(&self, tenant: &TenantId, sql, label_columns, value_column)` — new first
  param. It calls `self.auth.resolve(tenant)` and sets per-request headers:
  `X-ClickHouse-User`, `X-ClickHouse-Key`, `X-ClickHouse-Quota` (if `Some`), and the
  settings header. When `server_enforced_limits` is true, omit `readonly=1` from the
  settings header; otherwise behave exactly as today.
- `extra_settings` entries are appended to the settings header (unused by the three v1
  providers, but wired so a future provider needs no signature change).

**`RowQuerier` trait** gains the `tenant` param on `query_rows` so the evaluator/api call
through unchanged in shape. The single shared `Arc<dyn RowQuerier>` in `src/main.rs` stays
a single client — only its internal auth becomes per-request.

## Component 2 — The three providers (`CC_CH_AUTH_MODE`)

Selected by config; default `shared`.

### `shared` (default — zero behavior change)
Ignores tenant. Returns `CC_CH_USER` / `CC_CH_PASSWORD`, no quota,
`server_enforced_limits = false`. Reproduces today's behavior exactly, including the
client sending its own `readonly=1` + cost caps.

### `derived` (everr-compatible, generic)
Config:
- `CC_CH_USER_TEMPLATE` — e.g. `sql_api_org_{tenant}`. `{tenant}` is the only
  substitution token.
- `CC_CH_MASTER_KEY` — the HMAC key (a crown-jewel secret; see fail-closed).
- `CC_CH_PASSWORD_SUFFIX` — appended verbatim to the derived password (everr uses `A!`).
  Optional, default empty.

Derivation (crypto fixed, not configurable):
```
user = CC_CH_USER_TEMPLATE.replace("{tenant}", tenant)
key  = lowercase_hex(HMAC_SHA256(CC_CH_MASTER_KEY, tenant)) + CC_CH_PASSWORD_SUFFIX
quota = Some(user)
server_enforced_limits = true
```
With `CC_CH_USER_TEMPLATE=sql_api_org_{tenant}` and `CC_CH_PASSWORD_SUFFIX=A!` this
reproduces everr's exact username and password. A known-answer test pins this (see
Testing).

### `map` (explicit credentials)
Config: `CC_CH_TENANT_MAP` — a path to / inline JSON object of
`{ "<tenant>": { "user": "...", "password": "..." }, ... }`. `resolve` looks up the
tenant; `quota = Some(user)`, `server_enforced_limits = true`. A tenant absent from the
map is a resolve-time error surfaced as a query error (and is a candidate for the
rule-create preflight, below). For deployments whose scheme the template doesn't fit.

### Fail-closed construction
The provider is built **before any role logic**, unconditionally, mirroring the existing
`SecretCipher` pattern:
- `derived` with empty/missing `CC_CH_MASTER_KEY` → exit at startup with a clear error.
- `map` with a missing/unparseable/empty `CC_CH_TENANT_MAP` → exit at startup.
- Unknown `CC_CH_AUTH_MODE` → exit at startup.

So no role can silently run with broken or absent per-tenant auth.

## Component 3 — `TenantId`: UUID → validated string

`crates/domain/src/ids.rs` — change the newtype and add a fallible constructor:
```rust
pub struct TenantId(String);

impl TenantId {
    /// Accepts ^[A-Za-z0-9_.-]{1,64}$ — safe when interpolated into a ClickHouse
    /// username, a Redis key, or hashed for grouping. Covers everr nanoid org ids and
    /// UUID strings alike.
    pub fn parse(s: &str) -> Result<Self, InvalidTenantId> { /* charset + length check */ }
    pub fn as_str(&self) -> &str { &self.0 }
}
```
- **Charset rationale:** tenant flows into `sql_api_org_{tenant}` (a CH identifier), Redis
  keys, and the group hash. The charset forbids anything that could break those or inject.
  everr's default nanoid alphabet is URL-safe (`A-Za-z0-9_-`); UUID canonical form is
  `0-9a-f-`. Both pass. 64-char ceiling bounds key/identifier length.
- **Header parse** (`crates/api/src/auth.rs:16`): replace `Uuid::parse_str(raw).ok()`
  with `TenantId::parse(raw).ok()` — still returns `None`/rejects invalid input, so the
  validation UUID provided for free is preserved as an explicit rule.
- **sqlx** (`crates/stores/src/pg.rs`): `.bind(tenant.0)` → `.bind(&tenant.0)` (~50 sites);
  decode `TenantId(r.get("tenant"))` keeps working with a `text` column.
- **Migrations edited IN PLACE** (pre-production — no data to preserve): change every
  `tenant UUID NOT NULL` to `tenant TEXT NOT NULL` across the 8 tables (`rules`,
  `instances`, `subscriptions`, `notifications`, `receivers`, `routes`, `silences`,
  `inhibitions`) and `event_outbox`. Index definitions stay; sharding
  (`hashtext(tenant::text)`, `pg.rs:266`) and group hashing (`tenant.0.as_bytes()`,
  `dispatcher/src/grouping.rs:47`) work unchanged on text.
- **serde / Redis**: `String` serializes identically to the prior UUID string — no payload
  format change in `EvalJob` / `Event`.
- **Tests**: `TenantId(Uuid::new_v4())` (~42 sites) → a string helper, e.g.
  `TenantId::parse("t-<n>").unwrap()` or a `fn test_tenant(n)` helper.

## Component 4 — Identity-keyed coalescing

`QuerySig` (`crates/evaluator/src/lib.rs:18`) gains the **resolved auth identity** so two
jobs share a ClickHouse round-trip only when their results would be identical:
```rust
struct QuerySig {
    auth_user: String,                 // from ChAuthProvider::resolve(tenant).user
    auth_settings: Vec<(String,String)>, // resolve(...).extra_settings (sorted)
    sql: String,
    label_columns: Vec<String>,
    value_column: Option<String>,
}
```
- `shared` → `auth_user` constant across tenants → **full cross-tenant coalescing
  preserved** (no regression vs today).
- `derived` / `map` → `auth_user` differs per tenant → coalescing automatically stops
  where result sets would differ. Closes the latent cross-tenant row-sharing bug.

`process_batch` resolves auth once per job when building the group key (cheap; HMAC is
fast). The chosen group member's tenant is used for the actual `query_rows` call.

## Component 5 — The API `/test` path & error hygiene

- **`POST /v1/rules/:id/test`** and any other api-side ClickHouse execution must call
  `query_rows` with the **requesting tenant** through the same provider. Without this,
  rule-testing runs as the wrong/over-privileged user — a cross-tenant read hole in
  `derived`/`map` mode. The api crate receives `Arc<dyn RowQuerier>` (provider-backed)
  exactly as the evaluator does.
- **Error scrubbing**: `record_eval_error` stores `e.to_string()`
  (`crates/evaluator/src/lib.rs:126,134`). Audit and ensure a ClickHouse auth error can
  never embed the derived **password** (and prefer not to embed the username) before it is
  persisted. Reuse the `.without_url()`-style discipline from the notify path. The richer
  surfacing of these errors (degraded state, notifications) is **Spec B**.

## Out of scope (documented, not built here)

- **sqlguard table-function tripwire** — deferred to a future iteration; sqlguard stays
  shape-only. Documented as a known follow-up. The `derived` per-tenant users (no
  `SOURCES` grant) already close the SSRF vector for the everr deployment.
- **`setting` (RLS-via-injected-setting) provider** — dropped: weakest isolation, custom-
  setting-under-readonly footgun. The `extra_settings` field is reserved so it can be added
  later without a signature change.
- **Rule health / degraded-state notifications** — Spec B.
- **Provisioning** CH users/roles/policies — operator/everr responsibility.
- **Rule-create auth preflight** (fail loudly at create time if a tenant's CH user is
  missing) — noted as a strong follow-up; deferred unless trivially cheap to fold in. Not
  required for correctness (a missing user surfaces as an eval error today).

## Testing strategy

**Unit:**
- Each provider's `resolve`: `shared` returns configured creds and
  `server_enforced_limits=false`; `derived` produces a **known-answer** username +
  password for a fixed `CC_CH_MASTER_KEY` + tenant (golden vector matching everr's exact
  output, incl. the `A!` suffix and lowercase hex); `map` hits/misses.
- `TenantId::parse`: accept/reject table (valid nanoid, valid UUID string, empty,
  65 chars, spaces, `/`, `'`, `;`, non-ASCII).
- `QuerySig`: separates by `auth_user`/`auth_settings`; coalesces within identical
  identity; `shared` mode still coalesces two distinct tenants.
- Startup fail-closed: `derived` w/o master key, `map` w/ bad map, unknown mode each error.

**Integration (testcontainers):**
- `derived` mode against ClickHouse with two provisioned per-tenant users + row policies:
  an identical rule run for tenant A vs tenant B returns each tenant's own rows only —
  proving cross-tenant isolation via the resolved-per-tenant credentials. (Provisioning
  SQL lives in the test fixture, reflecting that clickety-clack does not provision.)
- `shared` mode regression: existing evaluator/e2e suites pass unchanged with the new
  `tenant` param threaded and the default provider.

## File-touch summary (for planning)

- `crates/domain/src/ids.rs` — `TenantId(String)` + `parse`.
- `crates/clickhouse/src/lib.rs` — `ChAuthProvider`/`ChAuth`, `ChClient` holds the
  provider, `query_rows(tenant, …)`, `RowQuerier` signature.
- New: provider impls (`shared`/`derived`/`map`) — likely
  `crates/clickhouse/src/auth.rs`.
- `src/config.rs` — `CC_CH_AUTH_MODE`, `CC_CH_USER_TEMPLATE`, `CC_CH_MASTER_KEY`,
  `CC_CH_PASSWORD_SUFFIX`, `CC_CH_TENANT_MAP`.
- `src/main.rs` — build provider (fail-closed) before role logic; inject into `ChClient`.
- `crates/evaluator/src/lib.rs` — `QuerySig` identity fields; resolve-per-job grouping;
  `query_rows(tenant, …)` call sites.
- `crates/api/...` — `/test` path threads tenant; provider-backed `RowQuerier`.
- `crates/stores/src/pg.rs` — `.bind(&tenant.0)`.
- `migrations/*.sql` — `tenant UUID` → `tenant TEXT` in place (8 tables + event_outbox).
- Tests across the above + a new integration test for per-tenant isolation.
- Docs: `reference/configuration.md` (new vars), a note in
  `how-to/harden-clickhouse-access.md` that `derived`/`map` make per-tenant least-privilege
  users the auth model.
