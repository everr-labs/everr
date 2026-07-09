# clickety-clack Phase 2b Implementation Plan — Routing & Multi-Channel Delivery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 2a "deliver every event to every webhook subscription" firehose with an Alertmanager-style **routing tree → receivers → multi-channel delivery**. Each firing/resolved event is matched against the tenant's ordered routes; matched routes resolve to named **receivers**; each receiver binds a **channel** (webhook, Slack, email/SMTP, PagerDuty). Delivery still flows through the Phase 2a `Notifier` trait with the existing dedup / retry-backoff / dead-letter / notification-log machinery — per event, immediately.

**Architecture:** The `dispatcher`'s `process_event` gains a routing front-end. For each event it loads the tenant's routes and receivers from Postgres, builds a matchable label set (`labels` + synthetic `severity`/`status`/`rule`), walks routes in priority order honoring `continue`, and resolves matched receiver names to channel configs. Each `(channel, target)` pair is delivered through a `Notifiers` registry that maps a channel name to its `Notifier` impl. The four channel impls (`WebhookNotifier` from 2a, plus new `SlackNotifier`, `PagerDutyNotifier`, `EmailNotifier`) all satisfy the **unchanged** `Notifier::send(target, ev)` trait — Slack/PagerDuty/webhook carry their destination in `target` (URL / routing key); email carries recipients in `target` while the shared SMTP transport lives in the notifier (process-level relay config). **Backward compatible:** a tenant with no routes configured falls back to the Phase 2a subscription firehose, so existing webhook subscribers and SSE keep working untouched.

**Tech Stack:** Rust 2021, `tokio`, `axum`, `sqlx` (Postgres), `redis`, `reqwest`, `regex`, `lettre` (async SMTP), `serde`/`serde_json`, `sha2`/`hex`, `async-trait`, `proptest`, `testcontainers` (+ Mailpit via `GenericImage`). Builds directly on the Phase 1 + Phase 2a crates already merged to `main` (`dca6874`).

---

## Context: Phase 1 + 2a contracts this builds on

Already on `main` (import, do not redefine):
- `cc_domain::Event { tenant: TenantId, rule: RuleId, instance_key: InstanceKey, status: EventStatus, labels: BTreeMap<String,String>, value: Option<f64>, severity: Severity, annotations, eval_ts }`; `EventStatus { Firing, Resolved }`; `Severity { Info, Warning, Critical }` (all serde lowercase).
- `cc_domain::ids::{TenantId(Uuid), RuleId(Uuid), InstanceKey(String)}`; `cc_domain::Subscription { id, tenant, webhook_url }`.
- `cc_queue::{EventBus, EventEntry}` over stream `cc:events` (group `dispatchers`), `RedisEventBus::connect(url)`, with `publish/consume/ack/tail/dead_letter`.
- `cc_stores::PgStore` (`connect`, `migrate` runs `migrations/`), incl. `subscriptions_for(tenant)`, `try_begin_notification(dedup_key, tenant, channel, target)->bool`, `mark_notification_sent`, `mark_notification_failed`, `notification_status`. `StoreError { Sqlx, Migrate, Json }`.
- `cc_dispatcher`: `dedup::dedup_key(target, ev)` (**signature changes in Task 3**), `notify::{Notifier, NotifyError, WebhookNotifier}`, `retry::{backoff_delay, deliver_with_retry}`, `run_dispatcher(consumer, store, bus, notifier, shutdown)` + `process_event` (**both change in Task 7**). `MAX_ATTEMPTS = 4`.
- `cc_api`: `AppState { store, ch, auth, events_tx }`, `build_router(state)`, `auth::Authenticator::tenant_from(&HeaderMap)`, `error::ApiError { Unauthorized, NotFound, Validation, Internal }`, handlers per resource (`rules.rs`/`subscriptions.rs` patterns).
- Binary `src/main.rs` + `src/config.rs`: role-selectable (`api`/`scheduler`/`evaluator`/`dispatcher`/`all`); `Config::from_env()`.

## Scope

**In scope (Phase 2b):**
- `cc-domain`: `ChannelConfig` enum + `Receiver`; `Matcher`/`MatchOp`/`Route` routing types.
- `migrations/0003_routing.sql` + `cc-stores` receivers/routes CRUD methods.
- `cc-dispatcher`: pure routing match (`routing.rs`), `Notifiers` registry, three new channel notifiers (`slack.rs`, `pagerduty.rs`, `email.rs`), and a routed `process_event`.
- `cc-api`: `/v1/receivers` and `/v1/routes` CRUD (secrets redacted on read).
- Binary wiring: build the `Notifiers` registry (webhook/Slack/PagerDuty always; email only when SMTP configured) and pass it to `run_dispatcher`; SMTP config from env.
- Docker-backed integration + e2e tests; workspace fmt/clippy gate.

**Out of scope (Phase 2c, separate plan):** grouping with `group_wait`/`group_interval` timers (Redis sorted-set sweeper, per-group buffer + flush-race correctness, nested routing-tree `group_by` overrides). Phase 2b delivers each event immediately to its matched receivers (no batching) — exactly the no-grouping baseline.

**Out of scope (Phase 3):** silences + inhibition; secret encryption-at-rest (2b stores channel secrets as JSONB and redacts on API read — documented); in-memory routing/receiver caching with Redis pub/sub invalidation (2b loads per event from Postgres — documented); stale-`pending` reconciliation sweep (carried over from 2a).

**Deliberate Phase 2b simplifications (documented, not defects):**
- **Flat ordered routes, not a nested tree.** Each tenant has a flat list of routes ordered by `priority` then `created_at`; matching walks them honoring `continue`. This delivers Alertmanager's essential ordered/`continue` semantics without a recursive tree. Nested routes with per-node `group_by` overrides are a Phase 2c/3 concern (they only matter once grouping exists).
- **No routing/receiver cache.** Routes + receivers are loaded from Postgres per event. The design's in-memory cache + pub/sub invalidation is a Phase 3 hot-path optimization.
- **Channel secrets stored as JSONB, redacted on read.** Encryption-at-rest is Phase 3.
- **Regex matchers compiled per call** (no compiled-matcher cache yet) and **anchored** (`^(?:…)$`, full-string match, like Alertmanager). An invalid regex never matches.
- **SMTP send failures classified `Transient`** (bounded-retry then dead-letter). Distinguishing permanent 5xx SMTP codes is a later refinement.

---

## File Structure

```
clickety-clack/
├── migrations/
│   └── 0003_routing.sql              # NEW: receivers, routes
├── crates/
│   ├── domain/src/
│   │   ├── lib.rs                     # MODIFY: export receiver + routing modules
│   │   ├── receiver.rs               # NEW: ChannelConfig, Receiver
│   │   └── routing.rs                # NEW: MatchOp, Matcher, Route
│   ├── stores/src/
│   │   └── pg.rs                      # MODIFY: receivers/routes CRUD
│   ├── dispatcher/
│   │   ├── Cargo.toml                 # MODIFY: regex, lettre
│   │   └── src/
│   │       ├── lib.rs                 # MODIFY: exports + routed process_event + run_dispatcher
│   │       ├── dedup.rs               # MODIFY: dedup_key gains `channel`
│   │       ├── registry.rs           # NEW: Notifiers registry
│   │       ├── routing.rs            # NEW: pure match_labels/select_receivers
│   │       ├── slack.rs              # NEW: SlackNotifier + build_slack_payload
│   │       ├── pagerduty.rs         # NEW: PagerDutyNotifier + build_pagerduty_payload
│   │       └── email.rs             # NEW: EmailNotifier + build_email_message
│   ├── api/
│   │   ├── Cargo.toml                 # (no change; cc-domain already a dep)
│   │   └── src/
│   │       ├── lib.rs                 # MODIFY: mount receivers + routes routes
│   │       ├── receivers.rs          # NEW: receivers CRUD (redacted reads)
│   │       └── routes.rs             # NEW: routes CRUD
├── src/
│   ├── config.rs                     # MODIFY: optional SmtpConfig from env
│   └── main.rs                       # MODIFY: build Notifiers registry; run_dispatcher
└── tests/
    └── e2e_routing.rs                # NEW: fire -> routed multi-channel delivery
```

## Conventions (same as Phases 1 & 2a)

- TDD: failing test → red → implement → green → commit. Bite-sized steps.
- Conventional commits; **no Claude/AI attribution anywhere** (no `Co-Authored-By`, no "Generated with", no mention of Claude/Anthropic/AI in commit messages, PR text, code, or comments).
- Run from repo root. Docker is available for `_it`/e2e tests.
- After each task: `cargo fmt --all` and `cargo clippy --all-targets -- -D warnings` clean.

---

### Task 0: Domain types — `ChannelConfig`, `Receiver`, routing types

**Files:**
- Create: `crates/domain/src/receiver.rs`
- Create: `crates/domain/src/routing.rs`
- Modify: `crates/domain/src/lib.rs`

- [ ] **Step 1: `crates/domain/src/receiver.rs`** (with inline failing tests):

```rust
use crate::ids::TenantId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A delivery channel binding. The secret-bearing variants (Slack, PagerDuty) are
/// redacted on API read via [`ChannelConfig::redacted`]. Email recipients live here;
/// the SMTP relay itself is process-level config held by the EmailNotifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ChannelConfig {
    Webhook { url: String },
    Slack { url: String },
    Pagerduty { routing_key: String },
    Email { to: Vec<String> },
}

impl ChannelConfig {
    /// The notifier-registry key (matches `Notifier::channel()`).
    pub fn channel_name(&self) -> &'static str {
        match self {
            ChannelConfig::Webhook { .. } => "webhook",
            ChannelConfig::Slack { .. } => "slack",
            ChannelConfig::Pagerduty { .. } => "pagerduty",
            ChannelConfig::Email { .. } => "email",
        }
    }

    /// The per-receiver destination string passed to `Notifier::send`:
    /// a URL (webhook/Slack), a routing key (PagerDuty), or comma-joined
    /// recipients (email).
    pub fn target(&self) -> String {
        match self {
            ChannelConfig::Webhook { url } => url.clone(),
            ChannelConfig::Slack { url } => url.clone(),
            ChannelConfig::Pagerduty { routing_key } => routing_key.clone(),
            ChannelConfig::Email { to } => to.join(","),
        }
    }

    /// Mask secret fields for API responses (never echo secrets back).
    pub fn redacted(&self) -> ChannelConfig {
        match self {
            ChannelConfig::Webhook { url } => ChannelConfig::Webhook { url: url.clone() },
            ChannelConfig::Slack { .. } => ChannelConfig::Slack { url: "***".into() },
            ChannelConfig::Pagerduty { .. } => ChannelConfig::Pagerduty {
                routing_key: "***".into(),
            },
            ChannelConfig::Email { to } => ChannelConfig::Email { to: to.clone() },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receiver {
    pub id: Uuid,
    pub tenant: TenantId,
    pub name: String,
    pub channel: ChannelConfig,
}

impl Receiver {
    /// Copy with channel secrets masked, for API responses.
    pub fn redacted(&self) -> Receiver {
        Receiver {
            id: self.id,
            tenant: self.tenant,
            name: self.name.clone(),
            channel: self.channel.redacted(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_name_and_target() {
        let s = ChannelConfig::Slack {
            url: "https://hooks.slack.test/abc".into(),
        };
        assert_eq!(s.channel_name(), "slack");
        assert_eq!(s.target(), "https://hooks.slack.test/abc");

        let e = ChannelConfig::Email {
            to: vec!["a@x.test".into(), "b@x.test".into()],
        };
        assert_eq!(e.channel_name(), "email");
        assert_eq!(e.target(), "a@x.test,b@x.test");
    }

    #[test]
    fn redacted_masks_secrets_but_keeps_kind() {
        let pd = ChannelConfig::Pagerduty {
            routing_key: "super-secret".into(),
        };
        match pd.redacted() {
            ChannelConfig::Pagerduty { routing_key } => assert_eq!(routing_key, "***"),
            _ => panic!("kind changed"),
        }
        // non-secret fields preserved
        let wh = ChannelConfig::Webhook {
            url: "http://x.test/h".into(),
        };
        assert_eq!(wh.redacted(), wh);
    }

    #[test]
    fn serde_is_externally_tagged_by_type() {
        let v = serde_json::to_value(ChannelConfig::Webhook {
            url: "http://x".into(),
        })
        .unwrap();
        assert_eq!(v["type"], "webhook");
        assert_eq!(v["url"], "http://x");
        let back: ChannelConfig = serde_json::from_value(v).unwrap();
        assert_eq!(
            back,
            ChannelConfig::Webhook {
                url: "http://x".into()
            }
        );
    }
}
```

- [ ] **Step 2: `crates/domain/src/routing.rs`** (with inline failing tests):

```rust
use crate::ids::TenantId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Label match operator. `regex`/`notregex` are anchored (full-string) at match time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchOp {
    Eq,
    Ne,
    Regex,
    NotRegex,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Matcher {
    pub label: String,
    pub op: MatchOp,
    pub value: String,
}

/// One node in the (flat, ordered) routing list. Routes are evaluated by ascending
/// `priority` then creation order; `continue == true` keeps matching subsequent routes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Route {
    pub id: Uuid,
    pub tenant: TenantId,
    pub matchers: Vec<Matcher>,
    pub receiver: String,
    #[serde(rename = "continue", default)]
    pub continue_matching: bool,
    #[serde(default)]
    pub priority: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matchop_serializes_lowercase() {
        assert_eq!(serde_json::to_value(MatchOp::NotRegex).unwrap(), "notregex");
        assert_eq!(serde_json::to_value(MatchOp::Eq).unwrap(), "eq");
    }

    #[test]
    fn route_uses_continue_json_key() {
        let r = Route {
            id: Uuid::nil(),
            tenant: TenantId(Uuid::nil()),
            matchers: vec![Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            receiver: "pd".into(),
            continue_matching: true,
            priority: 0,
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["continue"], true);
        let back: Route = serde_json::from_value(v).unwrap();
        assert_eq!(back, r);
    }
}
```

- [ ] **Step 3: Export from `crates/domain/src/lib.rs`.** Add the modules and re-exports:

```rust
pub mod event;
pub mod ids;
pub mod instance;
pub mod receiver;
pub mod routing;
pub mod rule;
pub mod subscription;

pub use event::{Event, EventStatus};
pub use ids::{InstanceKey, RuleId, TenantId};
pub use instance::{InstanceState, Status};
pub use receiver::{ChannelConfig, Receiver};
pub use routing::{MatchOp, Matcher, Route};
pub use rule::{Rule, RuleSpec, Severity};
pub use subscription::Subscription;
```

- [ ] **Step 4:** Run `cargo test -p cc-domain` — expect the new tests pass. `cargo clippy -p cc-domain --all-targets -- -D warnings`.

- [ ] **Step 5: Commit** — `git add crates/domain && git commit -m "feat(domain): ChannelConfig/Receiver + routing Matcher/Route types"`

---

### Task 1: Receivers + routes persistence (`migrations` + `cc-stores`)

**Files:**
- Create: `migrations/0003_routing.sql`
- Modify: `crates/stores/src/pg.rs`
- Create: `crates/stores/tests/routing_it.rs`

- [ ] **Step 1: Migration** — `migrations/0003_routing.sql`:

```sql
CREATE TABLE receivers (
    id          UUID PRIMARY KEY,
    tenant      UUID NOT NULL,
    name        TEXT NOT NULL,
    channel     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant, name)
);
CREATE INDEX receivers_tenant_idx ON receivers (tenant);

CREATE TABLE routes (
    id                UUID PRIMARY KEY,
    tenant            UUID NOT NULL,
    matchers          JSONB NOT NULL,
    receiver          TEXT NOT NULL,
    continue_matching BOOLEAN NOT NULL DEFAULT false,
    priority          INT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX routes_tenant_idx ON routes (tenant);
```

- [ ] **Step 2: Store methods.** In `crates/stores/src/pg.rs`, add these imports near the existing `use cc_domain::...` lines:

```rust
use cc_domain::receiver::{ChannelConfig, Receiver};
use cc_domain::routing::{Matcher, Route};
```

Then add to `impl PgStore` (after the notification-log section):

```rust
    // ---- receivers ----

    /// Create or replace a receiver by (tenant, name). Returns the stored receiver.
    /// Upsert semantics (PUT-like): re-issuing the same name updates its channel.
    pub async fn create_receiver(
        &self,
        tenant: TenantId,
        name: &str,
        channel: &ChannelConfig,
    ) -> Result<Receiver, StoreError> {
        let id = Uuid::new_v4();
        let ch_json = serde_json::to_value(channel)?;
        let row = sqlx::query(
            "INSERT INTO receivers (id, tenant, name, channel) VALUES ($1,$2,$3,$4)
             ON CONFLICT (tenant, name) DO UPDATE SET channel = EXCLUDED.channel
             RETURNING id",
        )
        .bind(id)
        .bind(tenant.0)
        .bind(name)
        .bind(&ch_json)
        .fetch_one(&self.pool)
        .await?;
        Ok(Receiver {
            id: row.get("id"),
            tenant,
            name: name.to_string(),
            channel: channel.clone(),
        })
    }

    pub async fn get_receiver(
        &self,
        tenant: TenantId,
        name: &str,
    ) -> Result<Option<Receiver>, StoreError> {
        let row =
            sqlx::query("SELECT id, tenant, name, channel FROM receivers WHERE tenant=$1 AND name=$2")
                .bind(tenant.0)
                .bind(name)
                .fetch_optional(&self.pool)
                .await?;
        match row {
            None => Ok(None),
            Some(r) => {
                let channel: ChannelConfig = serde_json::from_value(r.get("channel"))?;
                Ok(Some(Receiver {
                    id: r.get("id"),
                    tenant: TenantId(r.get("tenant")),
                    name: r.get("name"),
                    channel,
                }))
            }
        }
    }

    pub async fn list_receivers(&self, tenant: TenantId) -> Result<Vec<Receiver>, StoreError> {
        let rows =
            sqlx::query("SELECT id, tenant, name, channel FROM receivers WHERE tenant=$1 ORDER BY name")
                .bind(tenant.0)
                .fetch_all(&self.pool)
                .await?;
        let mut out = Vec::new();
        for r in &rows {
            let channel: ChannelConfig = serde_json::from_value(r.get("channel"))?;
            out.push(Receiver {
                id: r.get("id"),
                tenant: TenantId(r.get("tenant")),
                name: r.get("name"),
                channel,
            });
        }
        Ok(out)
    }

    pub async fn delete_receiver(&self, tenant: TenantId, name: &str) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM receivers WHERE tenant=$1 AND name=$2")
            .bind(tenant.0)
            .bind(name)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    // ---- routes ----

    pub async fn create_route(
        &self,
        tenant: TenantId,
        matchers: &[Matcher],
        receiver: &str,
        continue_matching: bool,
        priority: i32,
    ) -> Result<Route, StoreError> {
        let id = Uuid::new_v4();
        let m_json = serde_json::to_value(matchers)?;
        sqlx::query(
            "INSERT INTO routes (id, tenant, matchers, receiver, continue_matching, priority)
             VALUES ($1,$2,$3,$4,$5,$6)",
        )
        .bind(id)
        .bind(tenant.0)
        .bind(&m_json)
        .bind(receiver)
        .bind(continue_matching)
        .bind(priority)
        .execute(&self.pool)
        .await?;
        Ok(Route {
            id,
            tenant,
            matchers: matchers.to_vec(),
            receiver: receiver.to_string(),
            continue_matching,
            priority,
        })
    }

    /// All routes for a tenant, in evaluation order (priority asc, then creation order).
    pub async fn routes_for(&self, tenant: TenantId) -> Result<Vec<Route>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, matchers, receiver, continue_matching, priority
             FROM routes WHERE tenant=$1 ORDER BY priority ASC, created_at ASC",
        )
        .bind(tenant.0)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::new();
        for r in &rows {
            let matchers: Vec<Matcher> = serde_json::from_value(r.get("matchers"))?;
            out.push(Route {
                id: r.get("id"),
                tenant: TenantId(r.get("tenant")),
                matchers,
                receiver: r.get("receiver"),
                continue_matching: r.get("continue_matching"),
                priority: r.get("priority"),
            });
        }
        Ok(out)
    }

    pub async fn delete_route(&self, tenant: TenantId, id: Uuid) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM routes WHERE tenant=$1 AND id=$2")
            .bind(tenant.0)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
```

- [ ] **Step 3: Integration test** — `crates/stores/tests/routing_it.rs`:

```rust
use cc_domain::ids::TenantId;
use cc_domain::receiver::ChannelConfig;
use cc_domain::routing::{MatchOp, Matcher};
use cc_stores::PgStore;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use uuid::Uuid;

#[tokio::test]
async fn receivers_upsert_and_routes_order() {
    let node = Postgres::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let store = PgStore::connect(&url).await.unwrap();
    store.migrate().await.unwrap();

    let tenant = TenantId(Uuid::new_v4());

    // Upsert: same name twice keeps one row, latest channel wins.
    let r1 = store
        .create_receiver(tenant, "ops", &ChannelConfig::Webhook { url: "http://a".into() })
        .await
        .unwrap();
    let r2 = store
        .create_receiver(tenant, "ops", &ChannelConfig::Webhook { url: "http://b".into() })
        .await
        .unwrap();
    assert_eq!(r1.id, r2.id, "upsert keeps the same id");
    assert_eq!(store.list_receivers(tenant).await.unwrap().len(), 1);
    assert_eq!(
        store.get_receiver(tenant, "ops").await.unwrap().unwrap().channel,
        ChannelConfig::Webhook { url: "http://b".into() }
    );

    // Routes come back in priority order.
    store
        .create_route(tenant, &[matcher("severity", "warning")], "ops", true, 10)
        .await
        .unwrap();
    store
        .create_route(tenant, &[matcher("severity", "critical")], "pd", false, 1)
        .await
        .unwrap();
    let routes = store.routes_for(tenant).await.unwrap();
    assert_eq!(routes.len(), 2);
    assert_eq!(routes[0].receiver, "pd"); // priority 1 first
    assert_eq!(routes[1].receiver, "ops");

    // Delete works and is tenant-scoped.
    assert!(store.delete_route(tenant, routes[0].id).await.unwrap());
    assert_eq!(store.routes_for(tenant).await.unwrap().len(), 1);
    assert!(store.delete_receiver(tenant, "ops").await.unwrap());
    assert!(store.list_receivers(tenant).await.unwrap().is_empty());
}

fn matcher(label: &str, value: &str) -> Matcher {
    Matcher {
        label: label.into(),
        op: MatchOp::Eq,
        value: value.into(),
    }
}
```

- [ ] **Step 4: Run green** — `cargo test -p cc-stores --test routing_it` (Docker). `cargo clippy -p cc-stores --all-targets -- -D warnings`.

- [ ] **Step 5: Commit** — `git add crates/stores migrations && git commit -m "feat(stores): receivers + routes CRUD"`

---

### Task 2: Pure routing match (`cc-dispatcher/src/routing.rs`)

**Files:**
- Modify: `crates/dispatcher/Cargo.toml`
- Create: `crates/dispatcher/src/routing.rs`
- Modify: `crates/dispatcher/src/lib.rs` (add `pub mod routing;`)

- [ ] **Step 1: Add `regex` to `crates/dispatcher/Cargo.toml`** under `[dependencies]`:

```toml
regex = "1"
```

- [ ] **Step 2: `crates/dispatcher/src/routing.rs`** (with inline failing tests, incl. a proptest):

```rust
use cc_domain::routing::{MatchOp, Matcher, Route};
use cc_domain::rule::Severity;
use cc_domain::{Event, EventStatus};
use std::collections::BTreeMap;

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Info => "info",
        Severity::Warning => "warning",
        Severity::Critical => "critical",
    }
}

fn status_str(s: EventStatus) -> &'static str {
    match s {
        EventStatus::Firing => "firing",
        EventStatus::Resolved => "resolved",
    }
}

/// Build the matchable label set: the event's own labels plus synthetic `severity`,
/// `status`, and `rule` labels that routes may match on. Synthetic labels take
/// precedence over any same-named user label (they are inserted last).
pub fn match_labels(ev: &Event) -> BTreeMap<String, String> {
    let mut m = ev.labels.clone();
    m.insert("severity".to_string(), severity_str(ev.severity).to_string());
    m.insert("status".to_string(), status_str(ev.status).to_string());
    m.insert("rule".to_string(), ev.rule.0.to_string());
    m
}

/// Anchored (full-string) regex match. An invalid pattern never matches.
fn regex_full_match(pattern: &str, val: &str) -> bool {
    match regex::Regex::new(&format!("^(?:{pattern})$")) {
        Ok(re) => re.is_match(val),
        Err(_) => false,
    }
}

fn matcher_matches(m: &Matcher, labels: &BTreeMap<String, String>) -> bool {
    // A missing label is treated as the empty string (Alertmanager-like).
    let val = labels.get(&m.label).map(|s| s.as_str()).unwrap_or("");
    match m.op {
        MatchOp::Eq => val == m.value,
        MatchOp::Ne => val != m.value,
        MatchOp::Regex => regex_full_match(&m.value, val),
        MatchOp::NotRegex => !regex_full_match(&m.value, val),
    }
}

fn route_matches(r: &Route, labels: &BTreeMap<String, String>) -> bool {
    r.matchers.iter().all(|m| matcher_matches(m, labels))
}

/// Walk `routes` in the given order; collect receiver names of matching routes.
/// Stops after the first matching route unless it has `continue == true`. Receiver
/// names are de-duplicated while preserving first-match order. `routes` is expected
/// pre-ordered by the store (priority asc, then creation order).
pub fn select_receivers(routes: &[Route], labels: &BTreeMap<String, String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in routes {
        if route_matches(r, labels) {
            if !out.contains(&r.receiver) {
                out.push(r.receiver.clone());
            }
            if !r.continue_matching {
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use proptest::prelude::*;
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev(severity: Severity, labels: &[(&str, &str)]) -> Event {
        Event {
            tenant: TenantId(Uuid::nil()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey("k".into()),
            status: EventStatus::Firing,
            labels: labels
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            value: None,
            severity,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
        }
    }

    fn route(receiver: &str, cont: bool, matchers: Vec<Matcher>) -> Route {
        Route {
            id: Uuid::nil(),
            tenant: TenantId(Uuid::nil()),
            matchers,
            receiver: receiver.into(),
            continue_matching: cont,
            priority: 0,
        }
    }

    fn m(label: &str, op: MatchOp, value: &str) -> Matcher {
        Matcher {
            label: label.into(),
            op,
            value: value.into(),
        }
    }

    #[test]
    fn synthetic_severity_and_status_are_matchable() {
        let labels = match_labels(&ev(Severity::Critical, &[("svc", "api")]));
        assert_eq!(labels["severity"], "critical");
        assert_eq!(labels["status"], "firing");
        assert_eq!(labels["svc"], "api");
    }

    #[test]
    fn first_match_wins_without_continue() {
        let labels = match_labels(&ev(Severity::Critical, &[]));
        let routes = vec![
            route("pd", false, vec![m("severity", MatchOp::Eq, "critical")]),
            route("ops", false, vec![m("severity", MatchOp::Eq, "critical")]),
        ];
        assert_eq!(select_receivers(&routes, &labels), vec!["pd"]);
    }

    #[test]
    fn continue_collects_multiple_receivers() {
        let labels = match_labels(&ev(Severity::Critical, &[]));
        let routes = vec![
            route("pd", true, vec![m("severity", MatchOp::Eq, "critical")]),
            route("ops", false, vec![m("severity", MatchOp::Eq, "critical")]),
        ];
        assert_eq!(select_receivers(&routes, &labels), vec!["pd", "ops"]);
    }

    #[test]
    fn non_matching_routes_are_skipped() {
        let labels = match_labels(&ev(Severity::Warning, &[("svc", "api")]));
        let routes = vec![
            route("pd", false, vec![m("severity", MatchOp::Eq, "critical")]),
            route("ops", false, vec![m("svc", MatchOp::Eq, "api")]),
        ];
        assert_eq!(select_receivers(&routes, &labels), vec!["ops"]);
    }

    #[test]
    fn regex_is_anchored_and_ne_handles_missing() {
        let labels = match_labels(&ev(Severity::Warning, &[("svc", "api-1")]));
        // anchored: "api" alone does NOT match "api-1"
        assert!(select_receivers(
            &[route("r", false, vec![m("svc", MatchOp::Regex, "api")])],
            &labels
        )
        .is_empty());
        // "api-.*" matches
        assert_eq!(
            select_receivers(&[route("r", false, vec![m("svc", MatchOp::Regex, "api-.*")])], &labels),
            vec!["r"]
        );
        // Ne on a missing label (empty != "x") => matches
        assert_eq!(
            select_receivers(&[route("r", false, vec![m("absent", MatchOp::Ne, "x")])], &labels),
            vec!["r"]
        );
    }

    proptest! {
        // No matchers => route always matches; with `continue=false` exactly the first
        // route's receiver is selected, regardless of labels.
        #[test]
        fn empty_matchers_always_selects_first(extra in prop::collection::vec("[a-z]{1,4}", 0..3)) {
            let labels = match_labels(&ev(Severity::Info, &[]));
            let mut routes = vec![route("first", false, vec![])];
            for (i, name) in extra.iter().enumerate() {
                routes.push(route(&format!("{name}{i}"), false, vec![]));
            }
            prop_assert_eq!(select_receivers(&routes, &labels), vec!["first".to_string()]);
        }
    }
}
```

- [ ] **Step 3: Register the module** — add to the top of `crates/dispatcher/src/lib.rs` (alongside the other `pub mod` lines): `pub mod routing;`

- [ ] **Step 4:** Run `cargo test -p cc-dispatcher routing` — expect all pass. `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`. (`proptest` is already a workspace dependency; if it is not yet a `[dev-dependencies]` of `cc-dispatcher`, add `proptest.workspace = true` there.)

- [ ] **Step 5: Commit** — `git add crates/dispatcher && git commit -m "feat(dispatcher): pure routing match (label set + ordered receiver selection)"`

---

### Task 3: `dedup_key` gains a `channel` component

The dedup key must distinguish the same event delivered to the same `target` over **different channels** (e.g. a Slack URL vs a webhook URL that happen to collide is unlikely, but channel is part of identity). This is a focused signature change ahead of the Task 7 rewrite, keeping the build green.

**Files:**
- Modify: `crates/dispatcher/src/dedup.rs`
- Modify: `crates/dispatcher/src/lib.rs` (the one existing call site)
- Modify: `crates/dispatcher/tests/dispatch_it.rs` (the one existing call site)

- [ ] **Step 1: Update `dedup_key`** in `crates/dispatcher/src/dedup.rs` — add a `channel` parameter hashed before `target`:

```rust
/// Stable dedup key for "this exact event delivered to this target on this channel".
/// Identical for redeliveries of the same firing/resolved transition to the same
/// (channel, target) (same tenant+channel+target+instance+status+eval_ts), so
/// at-least-once stream redelivery never produces a duplicate notification. A later,
/// distinct transition (different eval_ts) yields a different key and is delivered.
pub fn dedup_key(channel: &str, target: &str, ev: &Event) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(ev.tenant.0.as_bytes());
    h.update(b"\x00");
    h.update(channel.as_bytes());
    h.update(b"\x00");
    h.update(target.as_bytes());
    h.update(b"\x00");
    h.update(ev.instance_key.0.as_bytes());
    h.update(b"\x00");
    h.update(match ev.status {
        cc_domain::EventStatus::Firing => b"firing".as_slice(),
        cc_domain::EventStatus::Resolved => b"resolved".as_slice(),
    });
    h.update(b"\x00");
    h.update(ev.eval_ts.unix_timestamp_nanos().to_be_bytes());
    hex::encode(h.finalize())
}
```

- [ ] **Step 2: Update the dedup unit tests** in the same file's `mod tests` to pass a channel. Change each `dedup_key("http://x", &ev(...))` call to `dedup_key("webhook", "http://x", &ev(...))` (and `"http://y"` similarly). Add one assertion that channel matters:

```rust
    #[test]
    fn differs_by_channel() {
        let a = dedup_key("webhook", "http://x", &ev(EventStatus::Firing, t(0)));
        let b = dedup_key("slack", "http://x", &ev(EventStatus::Firing, t(0)));
        assert_ne!(a, b);
    }
```

- [ ] **Step 3: Update the one call site** in `crates/dispatcher/src/lib.rs` (`process_event`): change `dedup::dedup_key(&sub.webhook_url, ev)` to `dedup::dedup_key("webhook", &sub.webhook_url, ev)`. (This line is replaced wholesale in Task 7; the change here just keeps 2a green.)

- [ ] **Step 4: Update the integration test** `crates/dispatcher/tests/dispatch_it.rs`: change `let key = dedup_key(&url, &ev(tenant));` to `let key = dedup_key("webhook", &url, &ev(tenant));`.

- [ ] **Step 5:** Run `cargo test -p cc-dispatcher dedup` (unit) and `cargo test -p cc-dispatcher --test dispatch_it` (Docker). `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`.

- [ ] **Step 6: Commit** — `git add crates/dispatcher && git commit -m "refactor(dispatcher): include channel in dedup_key"`

---

### Task 4: Slack channel (`slack.rs`)

**Files:**
- Create: `crates/dispatcher/src/slack.rs`
- Modify: `crates/dispatcher/src/lib.rs` (exports)
- Create: `crates/dispatcher/tests/slack_it.rs`

- [ ] **Step 1: `crates/dispatcher/src/slack.rs`** (pure payload builder + notifier, with inline unit test for the payload):

```rust
use crate::notify::{Notifier, NotifyError};
use async_trait::async_trait;
use cc_domain::rule::Severity;
use cc_domain::{Event, EventStatus};
use serde_json::{json, Value};

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Info => "info",
        Severity::Warning => "warning",
        Severity::Critical => "critical",
    }
}

/// Build a Slack incoming-webhook JSON payload for an event.
pub fn build_slack_payload(ev: &Event) -> Value {
    let (status, emoji) = match ev.status {
        EventStatus::Firing => ("FIRING", ":rotating_light:"),
        EventStatus::Resolved => ("RESOLVED", ":white_check_mark:"),
    };
    let mut fields: Vec<Value> = ev
        .labels
        .iter()
        .map(|(k, v)| json!({"title": k, "value": v, "short": true}))
        .collect();
    fields.push(json!({"title": "severity", "value": severity_str(ev.severity), "short": true}));
    let text = format!("{emoji} [{status}] {} — {}", severity_str(ev.severity), ev.instance_key.0);
    json!({
        "text": text,
        "attachments": [{
            "color": match ev.status { EventStatus::Firing => "#d00000", EventStatus::Resolved => "#2eb886" },
            "fields": fields,
        }]
    })
}

/// Slack incoming webhook. `target` is the Slack webhook URL. 2xx ok; 4xx permanent;
/// else transient.
pub struct SlackNotifier {
    http: reqwest::Client,
}

impl SlackNotifier {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("building reqwest client with timeout should not fail"),
        }
    }
}

impl Default for SlackNotifier {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Notifier for SlackNotifier {
    fn channel(&self) -> &'static str {
        "slack"
    }

    async fn send(&self, target: &str, ev: &Event) -> Result<(), NotifyError> {
        let resp = self
            .http
            .post(target)
            .json(&build_slack_payload(ev))
            .send()
            .await
            .map_err(|e| NotifyError::Transient(e.to_string()))?;
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else if status.is_client_error() {
            Err(NotifyError::Permanent(format!("status {status}")))
        } else {
            Err(NotifyError::Transient(format!("status {status}")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    #[test]
    fn payload_carries_status_and_labels() {
        let ev = Event {
            tenant: TenantId(Uuid::nil()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey("svc=api".into()),
            status: EventStatus::Firing,
            labels: BTreeMap::from([("svc".to_string(), "api".to_string())]),
            value: None,
            severity: Severity::Critical,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
        };
        let v = build_slack_payload(&ev);
        let text = v["text"].as_str().unwrap();
        assert!(text.contains("FIRING"));
        assert!(text.contains("critical"));
        assert!(text.contains("svc=api"));
        assert_eq!(v["attachments"][0]["color"], "#d00000");
    }
}
```

- [ ] **Step 2: Export** — in `crates/dispatcher/src/lib.rs` add `pub mod slack;` to the module list and `pub use slack::SlackNotifier;` to the re-exports.

- [ ] **Step 3: Stub-server integration test** — `crates/dispatcher/tests/slack_it.rs`:

```rust
use cc_dispatcher::notify::{Notifier, NotifyError};
use cc_dispatcher::slack::SlackNotifier;
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::rule::Severity;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use uuid::Uuid;

fn ev() -> Event {
    Event {
        tenant: TenantId(Uuid::nil()),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("k".into()),
        status: EventStatus::Firing,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

async fn start_server(status: u16, body_sink: Arc<Mutex<Option<serde_json::Value>>>) -> String {
    use axum::extract::Json;
    use axum::http::StatusCode;
    use axum::routing::post;
    use axum::Router;
    let code = StatusCode::from_u16(status).unwrap();
    let app = Router::new().route(
        "/hook",
        post(move |Json(body): Json<serde_json::Value>| {
            let sink = body_sink.clone();
            async move {
                *sink.lock().unwrap() = Some(body);
                code
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok(); });
    format!("http://{addr}/hook")
}

#[tokio::test]
async fn slack_posts_payload_and_2xx_ok() {
    let sink = Arc::new(Mutex::new(None));
    let url = start_server(200, sink.clone()).await;
    SlackNotifier::new().send(&url, &ev()).await.unwrap();
    let body = sink.lock().unwrap().clone().expect("server saw a body");
    assert!(body["text"].as_str().unwrap().contains("FIRING"));
}

#[tokio::test]
async fn slack_4xx_is_permanent() {
    let sink = Arc::new(Mutex::new(None));
    let url = start_server(400, sink).await;
    let err = SlackNotifier::new().send(&url, &ev()).await.unwrap_err();
    assert!(matches!(err, NotifyError::Permanent(_)));
}
```

- [ ] **Step 4:** Run `cargo test -p cc-dispatcher slack` (unit + `slack_it`). `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`.

- [ ] **Step 5: Commit** — `git add crates/dispatcher && git commit -m "feat(dispatcher): Slack channel notifier"`

---

### Task 5: PagerDuty channel (`pagerduty.rs`)

**Files:**
- Create: `crates/dispatcher/src/pagerduty.rs`
- Modify: `crates/dispatcher/src/lib.rs` (exports)
- Create: `crates/dispatcher/tests/pagerduty_it.rs`

- [ ] **Step 1: `crates/dispatcher/src/pagerduty.rs`** (Events API v2 payload + notifier with an injectable base URL for tests):

```rust
use crate::notify::{Notifier, NotifyError};
use async_trait::async_trait;
use cc_domain::rule::Severity;
use cc_domain::{Event, EventStatus};
use serde_json::{json, Value};

const DEFAULT_ENQUEUE_URL: &str = "https://events.pagerduty.com/v2/enqueue";

fn pd_severity(s: Severity) -> &'static str {
    match s {
        Severity::Info => "info",
        Severity::Warning => "warning",
        Severity::Critical => "critical",
    }
}

/// Build a PagerDuty Events API v2 payload. Firing => `trigger`, Resolved => `resolve`.
/// `dedup_key` is the instance key so PagerDuty correlates a resolve with its trigger
/// and auto-closes the incident.
pub fn build_pagerduty_payload(routing_key: &str, ev: &Event) -> Value {
    let action = match ev.status {
        EventStatus::Firing => "trigger",
        EventStatus::Resolved => "resolve",
    };
    json!({
        "routing_key": routing_key,
        "event_action": action,
        "dedup_key": ev.instance_key.0,
        "payload": {
            "summary": format!("[{}] {}", pd_severity(ev.severity), ev.instance_key.0),
            "source": ev.instance_key.0,
            "severity": pd_severity(ev.severity),
            "custom_details": ev.labels,
        }
    })
}

/// PagerDuty Events API v2. `target` is the integration routing key. 2xx (PD returns
/// 202) ok; 429 transient; other 4xx permanent; else transient.
pub struct PagerDutyNotifier {
    http: reqwest::Client,
    base_url: String,
}

impl PagerDutyNotifier {
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_ENQUEUE_URL)
    }

    /// For tests: point the enqueue POST at a stub server.
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("building reqwest client with timeout should not fail"),
            base_url: base_url.to_string(),
        }
    }
}

impl Default for PagerDutyNotifier {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Notifier for PagerDutyNotifier {
    fn channel(&self) -> &'static str {
        "pagerduty"
    }

    async fn send(&self, target: &str, ev: &Event) -> Result<(), NotifyError> {
        let resp = self
            .http
            .post(&self.base_url)
            .json(&build_pagerduty_payload(target, ev))
            .send()
            .await
            .map_err(|e| NotifyError::Transient(e.to_string()))?;
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else if status.as_u16() == 429 {
            Err(NotifyError::Transient("rate limited (429)".into()))
        } else if status.is_client_error() {
            Err(NotifyError::Permanent(format!("status {status}")))
        } else {
            Err(NotifyError::Transient(format!("status {status}")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev(status: EventStatus) -> Event {
        Event {
            tenant: TenantId(Uuid::nil()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey("svc=api".into()),
            status,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Critical,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn trigger_and_resolve_actions_and_dedup() {
        let f = build_pagerduty_payload("rk", &ev(EventStatus::Firing));
        assert_eq!(f["event_action"], "trigger");
        assert_eq!(f["dedup_key"], "svc=api");
        assert_eq!(f["routing_key"], "rk");
        assert_eq!(f["payload"]["severity"], "critical");
        let r = build_pagerduty_payload("rk", &ev(EventStatus::Resolved));
        assert_eq!(r["event_action"], "resolve");
    }
}
```

- [ ] **Step 2: Export** — in `crates/dispatcher/src/lib.rs` add `pub mod pagerduty;` and `pub use pagerduty::PagerDutyNotifier;`.

- [ ] **Step 3: Stub-server integration test** — `crates/dispatcher/tests/pagerduty_it.rs`:

```rust
use cc_dispatcher::notify::Notifier;
use cc_dispatcher::pagerduty::PagerDutyNotifier;
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::rule::Severity;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use uuid::Uuid;

async fn start_server(body_sink: Arc<Mutex<Option<serde_json::Value>>>) -> String {
    use axum::extract::Json;
    use axum::http::StatusCode;
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route(
        "/enqueue",
        post(move |Json(body): Json<serde_json::Value>| {
            let sink = body_sink.clone();
            async move {
                *sink.lock().unwrap() = Some(body);
                StatusCode::ACCEPTED // PD returns 202
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok(); });
    format!("http://{addr}/enqueue")
}

#[tokio::test]
async fn pagerduty_posts_trigger_and_accepts_202() {
    let sink = Arc::new(Mutex::new(None));
    let url = start_server(sink.clone()).await;
    let n = PagerDutyNotifier::with_base_url(&url);
    let ev = Event {
        tenant: TenantId(Uuid::nil()),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("svc=api".into()),
        status: EventStatus::Firing,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    };
    n.send("routing-key-123", &ev).await.unwrap();
    let body = sink.lock().unwrap().clone().expect("server saw a body");
    assert_eq!(body["routing_key"], "routing-key-123");
    assert_eq!(body["event_action"], "trigger");
    assert_eq!(body["dedup_key"], "svc=api");
}
```

- [ ] **Step 4:** Run `cargo test -p cc-dispatcher pagerduty`. `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`.

- [ ] **Step 5: Commit** — `git add crates/dispatcher && git commit -m "feat(dispatcher): PagerDuty channel notifier (Events API v2)"`

---

### Task 6: Email channel (`email.rs`, SMTP via `lettre`)

**Files:**
- Modify: `crates/dispatcher/Cargo.toml`
- Create: `crates/dispatcher/src/email.rs`
- Modify: `crates/dispatcher/src/lib.rs` (exports)
- Create: `crates/dispatcher/tests/email_it.rs`

- [ ] **Step 1: Add `lettre` to `crates/dispatcher/Cargo.toml`** `[dependencies]`:

```toml
lettre = { version = "0.11", default-features = false, features = ["builder", "smtp-transport", "tokio1", "tokio1-rustls-tls"] }
```

- [ ] **Step 2: `crates/dispatcher/src/email.rs`** (pure message builder + notifier; the SMTP transport is process-level):

```rust
use crate::notify::{Notifier, NotifyError};
use async_trait::async_trait;
use cc_domain::rule::Severity;
use cc_domain::{Event, EventStatus};
use lettre::message::Mailbox;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Info => "info",
        Severity::Warning => "warning",
        Severity::Critical => "critical",
    }
}

/// Build a plaintext email message for an event. A bad `from`/`to` address or empty
/// recipient list is a Permanent error (misconfiguration, not worth retrying).
pub fn build_email_message(from: &str, to: &[String], ev: &Event) -> Result<Message, NotifyError> {
    if to.is_empty() {
        return Err(NotifyError::Permanent("no recipients".into()));
    }
    let status = match ev.status {
        EventStatus::Firing => "FIRING",
        EventStatus::Resolved => "RESOLVED",
    };
    let subject = format!("[{status}] {} {}", severity_str(ev.severity), ev.instance_key.0);
    let mut body = format!(
        "status: {}\nseverity: {}\ninstance: {}\n",
        status.to_lowercase(),
        severity_str(ev.severity),
        ev.instance_key.0
    );
    for (k, v) in &ev.labels {
        body.push_str(&format!("{k}: {v}\n"));
    }

    let from_mbox: Mailbox = from
        .parse()
        .map_err(|e| NotifyError::Permanent(format!("bad from address: {e}")))?;
    let mut builder = Message::builder().from(from_mbox).subject(subject);
    for addr in to {
        let mbox: Mailbox = addr
            .parse()
            .map_err(|e| NotifyError::Permanent(format!("bad recipient {addr}: {e}")))?;
        builder = builder.to(mbox);
    }
    builder
        .body(body)
        .map_err(|e| NotifyError::Permanent(format!("building message: {e}")))
}

/// SMTP email channel. `target` is a comma-separated recipient list; the SMTP relay
/// (host/port/from/credentials) is process-level config held here. SMTP send failures
/// are classified Transient (bounded-retry then dead-letter); distinguishing permanent
/// 5xx codes is a later refinement.
pub struct EmailNotifier {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: String,
}

impl EmailNotifier {
    /// Build a notifier against a plaintext SMTP relay (no TLS). Optional credentials.
    pub fn new(
        host: &str,
        port: u16,
        from: &str,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Self {
        // builder_dangerous: plaintext connection (relay reachable on a trusted network
        // or a local test server such as Mailpit). TLS relays are a later refinement.
        let mut builder =
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host).port(port);
        if let (Some(u), Some(p)) = (username, password) {
            builder = builder.credentials(lettre::transport::smtp::authentication::Credentials::new(
                u.to_string(),
                p.to_string(),
            ));
        }
        Self {
            transport: builder.build(),
            from: from.to_string(),
        }
    }
}

#[async_trait]
impl Notifier for EmailNotifier {
    fn channel(&self) -> &'static str {
        "email"
    }

    async fn send(&self, target: &str, ev: &Event) -> Result<(), NotifyError> {
        let recipients: Vec<String> = target
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let msg = build_email_message(&self.from, &recipients, ev)?;
        self.transport
            .send(msg)
            .await
            .map(|_| ())
            .map_err(|e| NotifyError::Transient(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev() -> Event {
        Event {
            tenant: TenantId(Uuid::nil()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey("svc=api".into()),
            status: EventStatus::Firing,
            labels: BTreeMap::from([("svc".to_string(), "api".to_string())]),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn builds_message_with_subject_and_recipients() {
        let msg = build_email_message("from@x.test", &["a@x.test".into()], &ev()).unwrap();
        let formatted = String::from_utf8(msg.formatted()).unwrap();
        assert!(formatted.contains("Subject: [FIRING] warning svc=api"));
        assert!(formatted.contains("To: a@x.test"));
        assert!(formatted.contains("svc: api"));
    }

    #[test]
    fn empty_recipients_is_permanent() {
        let err = build_email_message("from@x.test", &[], &ev()).unwrap_err();
        assert!(matches!(err, NotifyError::Permanent(_)));
    }
}
```

- [ ] **Step 3: Export** — in `crates/dispatcher/src/lib.rs` add `pub mod email;` and `pub use email::EmailNotifier;`.

- [ ] **Step 4: SMTP integration test against Mailpit** — `crates/dispatcher/tests/email_it.rs`. Uses a pinned Mailpit container, sends an email, then polls Mailpit's HTTP API to confirm receipt:

```rust
use cc_dispatcher::email::EmailNotifier;
use cc_dispatcher::notify::Notifier;
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::rule::Severity;
use std::collections::BTreeMap;
use std::time::Duration;
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{GenericImage, ImageExt};
use time::OffsetDateTime;
use uuid::Uuid;

fn ev() -> Event {
    Event {
        tenant: TenantId(Uuid::nil()),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("svc=api".into()),
        status: EventStatus::Firing,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

#[tokio::test]
async fn email_is_delivered_to_mailpit() {
    // NOTE: if container startup hangs, this Mailpit version may log to stderr instead;
    // switch WaitFor::message_on_stdout -> message_on_stderr. Tag is pinned for a stable
    // startup line ("accessible via ...").
    let container = GenericImage::new("axllent/mailpit", "v1.20.4")
        .with_exposed_port(1025u16.tcp())
        .with_exposed_port(8025u16.tcp())
        .with_wait_for(WaitFor::message_on_stdout("accessible via"))
        .start()
        .await
        .unwrap();
    let smtp_port = container.get_host_port_ipv4(1025).await.unwrap();
    let http_port = container.get_host_port_ipv4(8025).await.unwrap();

    let notifier = EmailNotifier::new("127.0.0.1", smtp_port, "alerts@x.test", None, None);
    notifier.send("oncall@x.test", &ev()).await.unwrap();

    // Poll Mailpit's API until the message is visible.
    let api = format!("http://127.0.0.1:{http_port}/api/v1/messages");
    let client = reqwest::Client::new();
    let mut total = 0u64;
    for _ in 0..50 {
        if let Ok(resp) = client.get(&api).send().await {
            if let Ok(v) = resp.json::<serde_json::Value>().await {
                total = v["total"].as_u64().unwrap_or(0);
                if total >= 1 {
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(total, 1, "Mailpit should have received exactly one message");
}
```

- [ ] **Step 5:** Run `cargo test -p cc-dispatcher email` (unit) and `cargo test -p cc-dispatcher --test email_it` (Docker). `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`.

- [ ] **Step 6: Commit** — `git add crates/dispatcher && git commit -m "feat(dispatcher): email channel notifier over SMTP"`

---

### Task 7: Notifiers registry + routed `process_event`

**Files:**
- Create: `crates/dispatcher/src/registry.rs`
- Modify: `crates/dispatcher/src/lib.rs` (exports, `run_dispatcher`, `process_event`)
- Modify: `crates/dispatcher/tests/dispatch_it.rs` (build a registry for the fallback path)
- Modify: `tests/e2e_dispatch.rs` (root) (build a registry for its `run_dispatcher` call)
- Create: `crates/dispatcher/tests/routing_dispatch_it.rs`

- [ ] **Step 1: `crates/dispatcher/src/registry.rs`** — a channel→notifier map:

```rust
use crate::notify::Notifier;
use std::collections::HashMap;
use std::sync::Arc;

/// Registry of channel notifiers keyed by `Notifier::channel()`. Built once at
/// startup; the dispatcher looks up the notifier for each receiver's channel.
#[derive(Default)]
pub struct Notifiers {
    by_channel: HashMap<String, Arc<dyn Notifier>>,
}

impl Notifiers {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, notifier: Arc<dyn Notifier>) {
        self.by_channel
            .insert(notifier.channel().to_string(), notifier);
    }

    pub fn get(&self, channel: &str) -> Option<&Arc<dyn Notifier>> {
        self.by_channel.get(channel)
    }
}
```

- [ ] **Step 2: Rewrite the run loop + `process_event` in `crates/dispatcher/src/lib.rs`.** Update the top of the file so the exports include the registry and the run loop takes `Arc<Notifiers>`. Replace the existing `use`/`run_dispatcher`/`process_event` section (everything from the first `use cc_domain::Event;` down) with:

```rust
pub mod registry;

pub use registry::Notifiers;

use cc_domain::receiver::ChannelConfig;
use cc_domain::Event;
use cc_queue::{EventBus, EventEntry};
use cc_stores::PgStore;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

const MAX_ATTEMPTS: u32 = 4;

/// Run the dispatcher consume loop until `shutdown` flips true.
pub async fn run_dispatcher(
    consumer: String,
    store: PgStore,
    bus: Arc<dyn EventBus>,
    notifiers: Arc<Notifiers>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        let entries = match bus.consume(&consumer, 16, 2000).await {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(error = %e, "event consume failed");
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {}
                    _ = shutdown.changed() => {}
                }
                continue;
            }
        };
        for entry in entries {
            let ack_ok = process_event(&store, bus.as_ref(), notifiers.as_ref(), &entry).await;
            if ack_ok {
                if let Err(e) = bus.ack(&entry.id).await {
                    tracing::error!(error = %e, "event ack failed");
                }
            }
            // if !ack_ok: entry stays in the PEL (unacked) — preserved for Phase 3 reclaim.
        }
    }
    tracing::info!("dispatcher stopped");
}

/// Resolve an event to its delivery targets, then deliver each through the registry.
///
/// Routing: if the tenant has any routes, walk them (ordered) and resolve matched
/// receiver names to `(channel, target)` pairs. If the tenant has NO routes, fall back
/// to the Phase 2a subscription firehose (each webhook subscription) so existing
/// consumers keep working.
///
/// Returns true if the stream entry is safe to ack. Returns false only when we could
/// not load the routing inputs (routes/receivers/subscriptions) — the caller then
/// leaves the entry UNACKED in the consumer-group PEL so it is not lost (visible via
/// XPENDING; Phase 3 reconciliation reclaims it).
async fn process_event(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    entry: &EventEntry,
) -> bool {
    let ev: &Event = &entry.event;

    let routes = match store.routes_for(ev.tenant).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, entry_id = %entry.id, tenant = ?ev.tenant,
                "loading routes failed; leaving event unacked in PEL for later reclaim");
            return false;
        }
    };

    // Build the (channel, target) work list.
    let mut targets: Vec<(String, String)> = Vec::new();
    if routes.is_empty() {
        match store.subscriptions_for(ev.tenant).await {
            Ok(subs) => {
                for s in subs {
                    targets.push(("webhook".to_string(), s.webhook_url));
                }
            }
            Err(e) => {
                tracing::error!(error = %e, entry_id = %entry.id, tenant = ?ev.tenant,
                    "loading subscriptions failed; leaving event unacked in PEL for later reclaim");
                return false;
            }
        }
    } else {
        let receivers = match store.list_receivers(ev.tenant).await {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(error = %e, entry_id = %entry.id, tenant = ?ev.tenant,
                    "loading receivers failed; leaving event unacked in PEL for later reclaim");
                return false;
            }
        };
        let by_name: HashMap<String, ChannelConfig> =
            receivers.into_iter().map(|r| (r.name, r.channel)).collect();
        let labels = routing::match_labels(ev);
        for name in routing::select_receivers(&routes, &labels) {
            match by_name.get(&name) {
                Some(ch) => targets.push((ch.channel_name().to_string(), ch.target())),
                None => tracing::warn!(receiver = %name,
                    "route references unknown receiver; skipping"),
            }
        }
    }

    // TODO(phase2c): batch matched events into groups (group_wait/group_interval) before
    // delivery. Phase 2b delivers each event immediately.
    // TODO(phase3): cache routes/receivers in-memory with Redis pub/sub invalidation
    // instead of a Postgres load per event.
    let mut all_handled = true;
    for (channel, target) in targets {
        let key = dedup::dedup_key(&channel, &target, ev);
        match store
            .try_begin_notification(&key, ev.tenant, &channel, &target)
            .await
        {
            Ok(true) => {}
            // TODO(phase3): a row left 'pending' by a crash mid-delivery also lands here
            // as Ok(false) and is permanently skipped; Phase 3 needs a stale-pending sweep.
            Ok(false) => continue,
            Err(e) => {
                tracing::error!(error = %e, "begin notification failed");
                all_handled = false;
                continue;
            }
        }

        let notifier = match notifiers.get(&channel) {
            Some(n) => n,
            None => {
                // A receiver names a channel with no runtime notifier (e.g. an email
                // receiver while SMTP is unconfigured). Record failed + dead-letter so we
                // don't loop forever; the entry is still safe to ack.
                let reason = format!("no notifier registered for channel '{channel}'");
                if let Err(e) = store.mark_notification_failed(&key, 0, &reason).await {
                    tracing::error!(error = %e, key = %key, "mark_notification_failed write failed");
                }
                let _ = bus.dead_letter(ev, &reason).await;
                tracing::error!(channel = %channel, "no notifier registered; dead-lettered");
                continue;
            }
        };

        match retry::deliver_with_retry(notifier.as_ref(), &target, ev, MAX_ATTEMPTS).await {
            Ok(attempts) => {
                if let Err(e) = store.mark_notification_sent(&key, attempts).await {
                    tracing::error!(error = %e, key = %key,
                        "mark_notification_sent failed; row stuck 'pending' despite successful delivery — needs cleanup");
                }
            }
            Err((attempts, err)) => {
                let reason = err.to_string();
                if let Err(e) = store.mark_notification_failed(&key, attempts, &reason).await {
                    tracing::error!(error = %e, key = %key, "mark_notification_failed write failed");
                }
                match bus.dead_letter(ev, &reason).await {
                    Ok(()) => {
                        tracing::warn!(channel = %channel, target = %target, error = %err,
                            "notification dead-lettered")
                    }
                    Err(e) => {
                        tracing::error!(dead_letter_error = %e, original = %err, channel = %channel, target = %target,
                            "delivery failed AND dead-letter write failed — event not recorded in dead-letter stream")
                    }
                }
            }
        }
    }
    all_handled
}
```

Keep the existing top-of-file module declarations and re-exports for `dedup`/`notify`/`retry`/`routing`/`slack`/`pagerduty`/`email` as they are (this step adds `pub mod registry;` + `pub use registry::Notifiers;`). The final `lib.rs` module list should be: `dedup, email, notify, pagerduty, registry, retry, routing, slack`.

- [ ] **Step 3: Fix the fallback-path test** `crates/dispatcher/tests/dispatch_it.rs`. The test creates a subscription and no routes, so it exercises the firehose fallback. Update its `run_dispatcher` call to pass a registry instead of a bare notifier. Replace the notifier construction + spawn with:

```rust
    use cc_dispatcher::Notifiers;
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);
    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let handle = {
        let store = store.clone();
        let bus = bus.clone();
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifiers, sd_rx).await;
        })
    };
```

Also adjust the imports at the top of `dispatch_it.rs`: it currently imports `Notifier` and constructs `WebhookNotifier`; ensure `use cc_dispatcher::notify::WebhookNotifier;` and `use cc_dispatcher::{run_dispatcher, Notifiers};` are present (drop the now-unused `Notifier` import if clippy flags it).

- [ ] **Step 4: Fix the root e2e** `tests/e2e_dispatch.rs`. Locate its `run_dispatcher(...)` call (it passes a single `WebhookNotifier`). Wrap it in a registry the same way: build `let mut reg = Notifiers::new(); reg.register(Arc::new(WebhookNotifier::new())); let notifiers = Arc::new(reg);` and pass `notifiers` as the 4th argument. Add `use cc_dispatcher::Notifiers;` to its imports. This e2e uses webhook subscriptions and no routes, so it continues to exercise the fallback path unchanged.

- [ ] **Step 5: New routed-delivery integration test** — `crates/dispatcher/tests/routing_dispatch_it.rs`. Creates a receiver + a route (no subscription), publishes a firing event, runs the dispatcher, asserts the receiver's webhook stub is hit once and the notification row is `sent`:

```rust
use cc_dispatcher::dedup::dedup_key;
use cc_dispatcher::notify::WebhookNotifier;
use cc_dispatcher::{run_dispatcher, Notifiers};
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::receiver::ChannelConfig;
use cc_domain::routing::{MatchOp, Matcher};
use cc_domain::rule::Severity;
use cc_queue::event_bus::RedisEventBus;
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

async fn start_webhook(hits: Arc<Mutex<usize>>) -> String {
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route(
        "/hook",
        post(move || {
            let hits = hits.clone();
            async move {
                *hits.lock().unwrap() += 1;
                "ok"
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok(); });
    format!("http://{addr}/hook")
}

fn ev(tenant: TenantId) -> Event {
    Event {
        tenant,
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("svc=api".into()),
        status: EventStatus::Firing,
        labels: BTreeMap::from([("svc".to_string(), "api".to_string())]),
        value: Some(1.0),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

#[tokio::test]
async fn routed_event_delivers_to_matched_receiver() {
    let pg = Postgres::default().start().await.unwrap();
    let pg_url = format!(
        "postgres://postgres:postgres@127.0.0.1:{}/postgres",
        pg.get_host_port_ipv4(5432).await.unwrap()
    );
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    store.migrate().await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());

    let hits = Arc::new(Mutex::new(0usize));
    let url = start_webhook(hits.clone()).await;

    let tenant = TenantId(Uuid::new_v4());
    // Receiver + a route matching severity=critical. No webhook subscription.
    store
        .create_receiver(tenant, "ops", &ChannelConfig::Webhook { url: url.clone() })
        .await
        .unwrap();
    store
        .create_route(
            tenant,
            &[Matcher { label: "severity".into(), op: MatchOp::Eq, value: "critical".into() }],
            "ops",
            false,
            0,
        )
        .await
        .unwrap();

    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let handle = {
        let store = store.clone();
        let bus = bus.clone();
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifiers, sd_rx).await;
        })
    };

    bus.publish(&ev(tenant)).await.unwrap();

    for _ in 0..50 {
        if *hits.lock().unwrap() >= 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert_eq!(*hits.lock().unwrap(), 1, "matched receiver should be delivered once");
    let key = dedup_key("webhook", &url, &ev(tenant));
    assert_eq!(
        store.notification_status(&key).await.unwrap().unwrap().0,
        "sent"
    );

    let _ = sd_tx.send(true);
    let _ = handle.await;
}
```

- [ ] **Step 6:** Run `cargo test -p cc-dispatcher` (all dispatcher tests) and `cargo test --test e2e_dispatch` (Docker). `cargo clippy --all-targets -- -D warnings`. `cargo fmt --all`.

- [ ] **Step 7: Commit** — `git add crates/dispatcher tests && git commit -m "feat(dispatcher): route events to receivers via Notifiers registry; subscription firehose fallback"`

---

### Task 8: API CRUD for receivers + routes

**Files:**
- Create: `crates/api/src/receivers.rs`
- Create: `crates/api/src/routes.rs`
- Modify: `crates/api/src/lib.rs`
- Create: `crates/api/tests/routing_api.rs`

- [ ] **Step 1: `crates/api/src/receivers.rs`** (secrets redacted on every read response):

```rust
use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use cc_domain::receiver::{ChannelConfig, Receiver};
use serde::Deserialize;
use serde_json::{json, Value};

fn tenant(state: &AppState, headers: &HeaderMap) -> Result<cc_domain::ids::TenantId, ApiError> {
    state.auth.tenant_from(headers).ok_or(ApiError::Unauthorized)
}

#[derive(Deserialize)]
pub struct CreateReceiver {
    pub name: String,
    pub channel: ChannelConfig,
}

/// Create or replace a receiver (upsert by name). Returns the stored receiver redacted.
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateReceiver>,
) -> Result<Json<Receiver>, ApiError> {
    let t = tenant(&state, &headers)?;
    if body.name.trim().is_empty() {
        return Err(ApiError::Validation("name must not be empty".into()));
    }
    let rcv = state
        .store
        .create_receiver(t, &body.name, &body.channel)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(rcv.redacted()))
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let receivers = state
        .store
        .list_receivers(t)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let redacted: Vec<Receiver> = receivers.iter().map(|r| r.redacted()).collect();
    Ok(Json(json!(redacted)))
}

pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<Receiver>, ApiError> {
    let t = tenant(&state, &headers)?;
    state
        .store
        .get_receiver(t, &name)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .map(|r| Json(r.redacted()))
        .ok_or(ApiError::NotFound)
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state
        .store
        .delete_receiver(t, &name)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if ok {
        Ok(Json(json!({"deleted": true})))
    } else {
        Err(ApiError::NotFound)
    }
}
```

- [ ] **Step 2: `crates/api/src/routes.rs`:**

```rust
use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use cc_domain::routing::{Matcher, Route};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

fn tenant(state: &AppState, headers: &HeaderMap) -> Result<cc_domain::ids::TenantId, ApiError> {
    state.auth.tenant_from(headers).ok_or(ApiError::Unauthorized)
}

#[derive(Deserialize)]
pub struct CreateRoute {
    pub matchers: Vec<Matcher>,
    pub receiver: String,
    #[serde(rename = "continue", default)]
    pub continue_matching: bool,
    #[serde(default)]
    pub priority: i32,
}

/// Create a route. The referenced receiver need not exist yet (resolved at delivery
/// time; a missing receiver is logged and skipped by the dispatcher).
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateRoute>,
) -> Result<Json<Route>, ApiError> {
    let t = tenant(&state, &headers)?;
    if body.receiver.trim().is_empty() {
        return Err(ApiError::Validation("receiver must not be empty".into()));
    }
    let route = state
        .store
        .create_route(t, &body.matchers, &body.receiver, body.continue_matching, body.priority)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(route))
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let routes = state
        .store
        .routes_for(t)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!(routes)))
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state
        .store
        .delete_route(t, id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if ok {
        Ok(Json(json!({"deleted": true})))
    } else {
        Err(ApiError::NotFound)
    }
}
```

- [ ] **Step 3: Mount the routes** in `crates/api/src/lib.rs`. Add the two modules to the top:

```rust
pub mod receivers;
pub mod routes;
```

and add these routes to `build_router` (before `.with_state(state)`):

```rust
        .route("/v1/receivers", post(receivers::create).get(receivers::list))
        .route("/v1/receivers/:name", get(receivers::get).delete(receivers::delete))
        .route("/v1/routes", post(routes::create).get(routes::list))
        .route("/v1/routes/:id", axum::routing::delete(routes::delete))
```

- [ ] **Step 4: API test** — `crates/api/tests/routing_api.rs`. Builds the real router against a Postgres container (ClickHouse is unused by these handlers; a dummy `ChClient` is fine) and drives it with `tower::ServiceExt::oneshot`, asserting create→get redacts the Slack secret:

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
async fn receiver_create_then_get_redacts_secret() {
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

    // Create a Slack receiver.
    let create = Request::builder()
        .method("POST")
        .uri("/v1/receivers")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"name":"oncall","channel":{"type":"slack","url":"https://hooks.slack.test/SECRET"}}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = body_json(resp).await;
    assert_eq!(created["channel"]["url"], "***", "create response is redacted");

    // Get it back — also redacted.
    let get = Request::builder()
        .method("GET")
        .uri("/v1/receivers/oncall")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(get).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let got = body_json(resp).await;
    assert_eq!(got["name"], "oncall");
    assert_eq!(got["channel"]["type"], "slack");
    assert_eq!(got["channel"]["url"], "***");
}
```

Ensure `crates/api/Cargo.toml` `[dev-dependencies]` includes `tower` (for `ServiceExt::oneshot`) and `testcontainers` + `testcontainers-modules`. Add any that are missing:

```toml
tower = "0.5"
testcontainers.workspace = true
testcontainers-modules.workspace = true
```

- [ ] **Step 5:** Run `cargo test -p cc-api` (Docker for the new test). `cargo clippy -p cc-api --all-targets -- -D warnings`.

- [ ] **Step 6: Commit** — `git add crates/api && git commit -m "feat(api): receivers + routes CRUD with secret redaction"`

---

### Task 9: Binary wiring — Notifiers registry + SMTP config

**Files:**
- Modify: `src/config.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: SMTP config** — in `src/config.rs`, add an optional SMTP block. Add the struct and field:

```rust
#[derive(Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub from: String,
    pub username: Option<String>,
    pub password: Option<String>,
}
```

Add `pub smtp: Option<SmtpConfig>,` to `Config`, and in `from_env()` build it (email is enabled only when `CC_SMTP_HOST` is set):

```rust
        let smtp = env::var("CC_SMTP_HOST").ok().map(|host| SmtpConfig {
            host,
            port: var("CC_SMTP_PORT", "25").parse().unwrap_or(25),
            from: var("CC_SMTP_FROM", "alerts@localhost"),
            username: env::var("CC_SMTP_USER").ok(),
            password: env::var("CC_SMTP_PASSWORD").ok(),
        });
```

and include `smtp,` in the returned `Config { ... }`.

- [ ] **Step 2: Build the registry** in `src/main.rs`. Update the imports: replace `use cc_dispatcher::notify::WebhookNotifier;` / `use cc_dispatcher::{run_dispatcher, Notifier};` with:

```rust
use cc_dispatcher::email::EmailNotifier;
use cc_dispatcher::notify::WebhookNotifier;
use cc_dispatcher::pagerduty::PagerDutyNotifier;
use cc_dispatcher::slack::SlackNotifier;
use cc_dispatcher::{run_dispatcher, Notifiers};
```

Replace the `if run("dispatcher")` block with one that builds the registry:

```rust
    if run("dispatcher") {
        let mut reg = Notifiers::new();
        reg.register(Arc::new(WebhookNotifier::new()));
        reg.register(Arc::new(SlackNotifier::new()));
        reg.register(Arc::new(PagerDutyNotifier::new()));
        if let Some(smtp) = cfg.smtp.clone() {
            reg.register(Arc::new(EmailNotifier::new(
                &smtp.host,
                smtp.port,
                &smtp.from,
                smtp.username.as_deref(),
                smtp.password.as_deref(),
            )));
            tracing::info!(host = %smtp.host, "email channel enabled");
        } else {
            tracing::info!("email channel disabled (set CC_SMTP_HOST to enable)");
        }
        let notifiers = Arc::new(reg);
        let store = store.clone();
        let bus = event_bus.clone();
        let rx = sd_rx.clone();
        let consumer = cfg.node_id.clone();
        handles.push(tokio::spawn(async move {
            run_dispatcher(consumer, store, bus, notifiers, rx).await;
        }));
    }
```

- [ ] **Step 3:** Run `cargo build` (whole workspace) and `cargo clippy --all-targets -- -D warnings`. `cargo fmt --all`.

- [ ] **Step 4: Commit** — `git add src && git commit -m "feat(bin): build multi-channel Notifiers registry; optional SMTP config"`

---

### Task 10: End-to-end routed delivery + workspace gate

**Files:**
- Create: `tests/e2e_routing.rs`

- [ ] **Step 1: e2e test** — `tests/e2e_routing.rs`. Brings up Postgres + Redis, registers two receivers (a webhook + a "slack" receiver both pointing at axum stubs) with a `continue` route fan-out, publishes one firing event directly to the bus, runs the real `run_dispatcher` with the full registry, and asserts BOTH stubs are hit and both notification rows are `sent`:

```rust
use cc_dispatcher::notify::WebhookNotifier;
use cc_dispatcher::slack::SlackNotifier;
use cc_dispatcher::{run_dispatcher, Notifiers};
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::receiver::ChannelConfig;
use cc_domain::routing::{MatchOp, Matcher};
use cc_domain::rule::Severity;
use cc_queue::event_bus::RedisEventBus;
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

async fn start_stub(hits: Arc<Mutex<usize>>) -> String {
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route(
        "/hook",
        post(move || {
            let hits = hits.clone();
            async move {
                *hits.lock().unwrap() += 1;
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
async fn fan_out_to_webhook_and_slack_receivers() {
    let pg = Postgres::default().start().await.unwrap();
    let pg_url = format!(
        "postgres://postgres:postgres@127.0.0.1:{}/postgres",
        pg.get_host_port_ipv4(5432).await.unwrap()
    );
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    store.migrate().await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());

    let wh_hits = Arc::new(Mutex::new(0usize));
    let slack_hits = Arc::new(Mutex::new(0usize));
    let wh_url = start_stub(wh_hits.clone()).await;
    let slack_url = start_stub(slack_hits.clone()).await;

    let tenant = TenantId(Uuid::new_v4());
    store
        .create_receiver(tenant, "ops", &ChannelConfig::Webhook { url: wh_url.clone() })
        .await
        .unwrap();
    store
        .create_receiver(tenant, "chat", &ChannelConfig::Slack { url: slack_url.clone() })
        .await
        .unwrap();
    // Two routes both matching severity=critical; first has continue=true so both fire.
    store
        .create_route(
            tenant,
            &[Matcher { label: "severity".into(), op: MatchOp::Eq, value: "critical".into() }],
            "ops",
            true,
            0,
        )
        .await
        .unwrap();
    store
        .create_route(
            tenant,
            &[Matcher { label: "severity".into(), op: MatchOp::Eq, value: "critical".into() }],
            "chat",
            false,
            1,
        )
        .await
        .unwrap();

    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    reg.register(Arc::new(SlackNotifier::new()));
    let notifiers = Arc::new(reg);

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let handle = {
        let store = store.clone();
        let bus = bus.clone();
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifiers, sd_rx).await;
        })
    };

    let ev = Event {
        tenant,
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("svc=api".into()),
        status: EventStatus::Firing,
        labels: BTreeMap::from([("svc".to_string(), "api".to_string())]),
        value: Some(1.0),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    };
    bus.publish(&ev).await.unwrap();

    for _ in 0..50 {
        if *wh_hits.lock().unwrap() >= 1 && *slack_hits.lock().unwrap() >= 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert_eq!(*wh_hits.lock().unwrap(), 1, "webhook receiver delivered once");
    assert_eq!(*slack_hits.lock().unwrap(), 1, "slack receiver delivered once");

    let _ = sd_tx.send(true);
    let _ = handle.await;
}
```

- [ ] **Step 2: Whole-workspace gate.** Run:
  - `cargo fmt --all`
  - `cargo clippy --all-targets -- -D warnings`
  - `cargo test` (whole workspace; Docker available) — expect all green, including the new `e2e_routing`.

- [ ] **Step 3: Commit** — `git add tests && git commit -m "test(e2e): routed fan-out to webhook + slack receivers"`

---

## Self-Review (controller checklist before execution)

- **Spec coverage:** routing tree + receivers (Tasks 0/1/2/7/8), multi-channel delivery Slack/email/PagerDuty/webhook behind the unchanged `Notifier` trait (Tasks 4/5/6/7/9), notification log + dedup + retry + dead-letter reused from 2a (Task 7), API CRUD with secret redaction (Task 8). Grouping is explicitly Phase 2c (documented). Silences/inhibition remain Phase 3.
- **Type consistency:** `dedup_key(channel, target, ev)` updated everywhere it is called (Task 3 + Task 7). `run_dispatcher(.., notifiers: Arc<Notifiers>, ..)` updated at all three call sites (`dispatch_it`, `e2e_dispatch`, `main.rs`). `ChannelConfig::channel_name()` strings (`webhook`/`slack`/`pagerduty`/`email`) match each `Notifier::channel()` return value. `Route.continue_matching` ↔ JSON `"continue"` consistent across domain, store, and API.
- **Backward compatibility:** no-routes tenants keep the 2a subscription firehose; `dispatch_it` and `e2e_dispatch` (which use subscriptions, no routes) still exercise it and stay green.
- **No placeholders:** every step has complete code or an exact command. The only soft spot is the Mailpit `WaitFor` log line — pinned image tag + an in-test poll loop make it robust, with an inline note on the stdout/stderr fallback.

## Execution Handoff

This plan is ready for **superpowers:subagent-driven-development** (fresh subagent per task, spec-then-quality review between tasks), the same workflow used for Phases 1 and 2a. Suggested model use: cheap/fast model for the mechanical channel tasks (4/5/6) and domain/store tasks (0/1), standard model for the dispatcher rewrite (7) and binary wiring (9).
