# Phase 2c — Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Batch a burst of routed alert events into a single grouped notification per receiver, held for `group_wait` and spaced by `group_interval`, with timers in Redis so any dispatcher replica can flush.

**Architecture:** Routed events are no longer delivered immediately — they are buffered into a per-(tenant, receiver, group-labels) group in Redis (a hash of active events keyed by instance) and a flush time is armed in a Redis sorted-set. A new `run_group_flusher` loop on every dispatcher replica atomically claims due groups (Lua), renders the active set into one `Notification`, and delivers it through the existing notification-log / retry / dead-letter path. The `Notifier` trait changes from a single `Event` to a `Notification { group_key, events }` so every channel renders a batch. The legacy no-routes subscription firehose stays immediate (one-event `Notification`), preserving Phase 2a/2b behavior.

**Tech Stack:** Rust workspace (cc-domain, cc-queue, cc-stores, cc-dispatcher, root `cc` bin), tokio, axum 0.7, sqlx 0.8 (Postgres), redis 0.27 (Streams + ZSET + Lua via `redis::Script`), reqwest 0.12, lettre 0.11, sha2/hex, serde/serde_json, async-trait, proptest, testcontainers 0.23 / testcontainers-modules 0.11.

**Conventions (apply to every task):** TDD — write the failing test first, watch it fail, implement, watch it pass, commit. `cargo clippy --all-targets -- -D warnings` must stay clean. The real gate is `cargo test --workspace --no-fail-fast` (the root is a combined package+workspace; bare `cargo test` runs only the 2 root e2e tests). **No Claude / Anthropic / AI attribution anywhere** — not in commit messages, not in code comments, no `Co-Authored-By`, no "Generated with" footers.

**Key design decisions (locked in):**
1. **True batching.** `Notifier::send` takes `&Notification { group_key: String, events: Vec<Event> }`. Webhook posts `{group_key, events:[…]}`; Slack renders one message listing all events; email renders one mail listing all events; PagerDuty loops the batch (one Events-API call per event — PD incidents are per-`dedup_key`/instance and its own dedup makes batch-retry idempotent).
2. **Per-route grouping config with defaults.** `Route` gains optional `group_by: Option<Vec<String>>`, `group_wait_secs: Option<u32>`, `group_interval_secs: Option<u32>`. Defaults when unset: `group_by = ["rule","severity"]` (tenant + receiver are always implicit in the group identity), `group_wait = 10s`, `group_interval = 300s`.
3. **Redis-backed groups, no sticky ownership.** Group membership is a Redis hash `cc:group:{group_id}` (field `ev:{instance_key}` → event JSON, plus `__meta__` and `__last_flush__`); flush timers are a ZSET `cc:groupflush` (member = group_id, score = due-ms). Add/claim/take are atomic Lua scripts so any replica can flush.
4. **Firehose unchanged.** Tenants with no routes still get immediate per-event webhook delivery (wrapped as a one-event `Notification`), keyed by the existing per-event `dedup_key`.
5. **Flush semantics.** `take_group` atomically snapshots the active set and clears the event fields (keeping `__meta__`, stamping `__last_flush__`). A failed flush dead-letters (consistent with Phase 2b) rather than re-buffering; a later event re-arms the group. This trade-off is documented in code.

---

## File Structure

**Create:**
- `crates/dispatcher/src/grouping.rs` — pure functions: default consts, `group_by_values`, `group_key_string`, `group_id`, `fingerprint`, `group_dedup_key`.
- `crates/queue/src/groups.rs` — `GroupMeta`, `GroupStore` trait, `RedisGroups` (Lua add/claim/take).
- `crates/queue/tests/groups_it.rs` — Docker Redis integration test for `RedisGroups`.
- `migrations/0004_grouping.sql` — add nullable grouping columns to `routes`.
- `tests/e2e_grouping.rs` — root e2e: two firing events batched into one grouped webhook.

**Modify:**
- `crates/dispatcher/src/notify.rs` — add `Notification`; change `Notifier::send`; rewrite `WebhookNotifier` payload.
- `crates/dispatcher/src/retry.rs` — `deliver_with_retry` takes `&Notification`.
- `crates/dispatcher/src/slack.rs`, `pagerduty.rs`, `email.rs` — batch rendering + new `send` signature.
- `crates/dispatcher/src/routing.rs` — add `GroupingParams`, `MatchedTarget`, `select_grouping_targets`.
- `crates/dispatcher/src/lib.rs` — buffer path in `process_event`, `run_group_flusher`, `run_dispatcher` gains `groups` param, re-exports.
- `crates/dispatcher/Cargo.toml` — no new deps (sha2/hex already present).
- `crates/queue/src/lib.rs` — `pub mod groups;` + re-exports.
- `crates/queue/Cargo.toml` — add `uuid` to `[dependencies]`.
- `crates/domain/src/routing.rs` — `Route` grouping fields.
- `crates/stores/src/pg.rs` — `create_route` signature + `routes_for` read new columns.
- `crates/api/src/routes.rs` — `CreateRoute` body gains grouping fields.
- Test call sites: `crates/dispatcher/tests/{webhook_it,slack_it,pagerduty_it,email_it,dispatch_it,routing_dispatch_it}.rs`, `crates/stores/tests/routing_it.rs`, `tests/e2e_dispatch.rs`, `tests/e2e_routing.rs`, `src/main.rs`.

---

## Task 1: Notifier trait → `Notification` (true batching)

This is one atomic trait migration: every `Notifier` impl, `deliver_with_retry`, and the direct-`send` tests change together so the workspace stays green. No dispatcher-loop wiring yet (that's Task 5).

**Files:**
- Modify: `crates/dispatcher/src/notify.rs`
- Modify: `crates/dispatcher/src/retry.rs`
- Modify: `crates/dispatcher/src/slack.rs`
- Modify: `crates/dispatcher/src/pagerduty.rs`
- Modify: `crates/dispatcher/src/email.rs`
- Modify (tests): `crates/dispatcher/tests/webhook_it.rs`, `slack_it.rs`, `pagerduty_it.rs`, `email_it.rs`, `dispatch_it.rs`
- Modify (tests): `tests/e2e_dispatch.rs`

- [ ] **Step 1: Write the failing unit test for the webhook batch payload**

In `crates/dispatcher/src/notify.rs`, replace the existing `#[cfg(test)]`-less file tail by adding this module at the end of the file (it will not compile until `Notification` exists — that's the failing state):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::event::{Event, EventStatus};
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use cc_domain::rule::Severity;
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev(instance: &str) -> Event {
        Event {
            tenant: TenantId(Uuid::nil()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey(instance.into()),
            status: EventStatus::Firing,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn notification_holds_group_key_and_events() {
        let n = Notification {
            group_key: "rule=r,severity=warning".into(),
            events: vec![ev("a"), ev("b")],
        };
        assert_eq!(n.group_key, "rule=r,severity=warning");
        assert_eq!(n.events.len(), 2);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p cc-dispatcher --lib notify`
Expected: FAIL to compile — `cannot find type Notification`.

- [ ] **Step 3: Add `Notification` and change the trait + webhook impl**

Replace the top of `crates/dispatcher/src/notify.rs` (the `NotifyError`, trait, and `WebhookNotifier::send`) with:

```rust
use async_trait::async_trait;
use cc_domain::Event;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NotifyError {
    /// Worth retrying (timeout, connection error, 5xx).
    #[error("transient: {0}")]
    Transient(String),
    /// Not worth retrying (4xx, malformed target).
    #[error("permanent: {0}")]
    Permanent(String),
}

/// A batch of active events for one group, delivered as a single notification.
/// `events` is always non-empty; `group_key` is a human-readable group identity
/// (e.g. `"rule=…,severity=critical"`) included in rendered payloads.
#[derive(Debug, Clone)]
pub struct Notification {
    pub group_key: String,
    pub events: Vec<Event>,
}

impl Notification {
    /// Wrap a single event as a one-member notification (firehose / immediate path).
    pub fn single(ev: &Event) -> Self {
        Self {
            group_key: ev.instance_key.0.clone(),
            events: vec![ev.clone()],
        }
    }
}

/// A delivery channel. Each impl renders a `Notification` (one or more events) into
/// one channel-native message.
#[async_trait]
pub trait Notifier: Send + Sync {
    fn channel(&self) -> &'static str;
    /// Deliver `notif` to `target`. Classify failures as Transient vs Permanent.
    async fn send(&self, target: &str, notif: &Notification) -> Result<(), NotifyError>;
}

/// Generic webhook: POST `{group_key, events:[…]}` as JSON. 2xx = ok, 4xx = permanent,
/// else transient.
pub struct WebhookNotifier {
    http: reqwest::Client,
}

impl WebhookNotifier {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("building reqwest client with timeout should not fail"),
        }
    }
}

impl Default for WebhookNotifier {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Notifier for WebhookNotifier {
    fn channel(&self) -> &'static str {
        "webhook"
    }

    async fn send(&self, target: &str, notif: &Notification) -> Result<(), NotifyError> {
        let body = serde_json::json!({
            "group_key": notif.group_key,
            "events": notif.events,
        });
        let resp = self
            .http
            .post(target)
            .json(&body)
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
```

- [ ] **Step 4: Run the webhook test to verify it passes**

Run: `cargo test -p cc-dispatcher --lib notify`
Expected: PASS (`notification_holds_group_key_and_events`).

- [ ] **Step 5: Update `deliver_with_retry` to take `&Notification`**

In `crates/dispatcher/src/retry.rs`, change the signature, the `notifier.send` call, and the test harness:

Replace the `use` line and `deliver_with_retry`:

```rust
use crate::notify::{Notification, Notifier, NotifyError};
use std::time::Duration;

/// Deterministic exponential backoff: base * 2^attempt, capped. No jitter (Phase 2a).
pub fn backoff_delay(attempt: u32, base_ms: u64, cap_ms: u64) -> Duration {
    let shifted = base_ms.checked_shl(attempt).unwrap_or(u64::MAX);
    Duration::from_millis(shifted.min(cap_ms))
}

/// Try delivery up to `max_attempts`. Retries only on Transient errors, sleeping
/// `backoff_delay` between attempts. Returns Ok(attempts_used) on success, or the
/// last error (Permanent stops immediately; Transient stops after max_attempts).
pub async fn deliver_with_retry(
    notifier: &dyn Notifier,
    target: &str,
    notif: &Notification,
    max_attempts: u32,
) -> Result<u32, (u32, NotifyError)> {
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match notifier.send(target, notif).await {
            Ok(()) => return Ok(attempt),
            Err(NotifyError::Permanent(e)) => return Err((attempt, NotifyError::Permanent(e))),
            Err(NotifyError::Transient(e)) => {
                if attempt >= max_attempts {
                    return Err((attempt, NotifyError::Transient(e)));
                }
                tokio::time::sleep(backoff_delay(attempt - 1, 50, 5_000)).await;
            }
        }
    }
}
```

In the same file's `#[cfg(test)]` module: change the `use` to include `Notification`, change both stub impls' `send` signatures, replace `ev()` returning the bare event with a `notif()` helper, and update the three `deliver_with_retry` call sites. Replace the test module's `use` block and `ev` helper and stub signatures:

```rust
    use super::*;
    use crate::notify::{Notification, Notifier, NotifyError};
    use async_trait::async_trait;
    use cc_domain::event::{Event, EventStatus};
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use cc_domain::rule::Severity;
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn notif() -> Notification {
        let ev = Event {
            tenant: TenantId(Uuid::nil()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey("k".into()),
            status: EventStatus::Firing,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
        };
        Notification::single(&ev)
    }
```

Change `Flaky::send` and `AlwaysPermanent::send` signatures from `async fn send(&self, _t: &str, _e: &Event)` to `async fn send(&self, _t: &str, _n: &Notification)` (and drop the now-unused `Event` import if clippy flags it — it is used by `notif()`, so keep it). Update the three call sites:

```rust
        let attempts = deliver_with_retry(&n, "t", &notif(), 5).await.unwrap();
```
```rust
        let (attempts, err) = deliver_with_retry(&n, "t", &notif(), 5).await.unwrap_err();
```
```rust
        let (attempts, err) = deliver_with_retry(&n, "t", &notif(), 3).await.unwrap_err();
```

- [ ] **Step 6: Update Slack to render a batch**

In `crates/dispatcher/src/slack.rs`, change the `use`, replace `build_slack_payload`, and change `send`. Replace `use crate::notify::{Notifier, NotifyError};` with `use crate::notify::{Notification, Notifier, NotifyError};`. Replace `build_slack_payload` and the `Notifier::send` body:

```rust
/// Build a Slack incoming-webhook JSON payload for a notification (one or more events).
pub fn build_slack_payload(notif: &Notification) -> Value {
    let n = notif.events.len();
    let header = if n == 1 {
        let ev = &notif.events[0];
        let (status, emoji) = match ev.status {
            EventStatus::Firing => ("FIRING", ":rotating_light:"),
            EventStatus::Resolved => ("RESOLVED", ":white_check_mark:"),
        };
        format!(
            "{emoji} [{status}] {} — {}",
            severity_str(ev.severity),
            ev.instance_key.0
        )
    } else {
        format!(":rotating_light: [{n} alerts] {}", notif.group_key)
    };
    let attachments: Vec<Value> = notif
        .events
        .iter()
        .map(|ev| {
            let mut fields: Vec<Value> = ev
                .labels
                .iter()
                .map(|(k, v)| json!({"title": k, "value": v, "short": true}))
                .collect();
            fields.push(
                json!({"title": "severity", "value": severity_str(ev.severity), "short": true}),
            );
            fields.push(json!({"title": "instance", "value": ev.instance_key.0, "short": true}));
            json!({
                "color": match ev.status { EventStatus::Firing => "#d00000", EventStatus::Resolved => "#2eb886" },
                "fields": fields,
            })
        })
        .collect();
    json!({ "text": header, "attachments": attachments })
}
```

```rust
    async fn send(&self, target: &str, notif: &Notification) -> Result<(), NotifyError> {
        let resp = self
            .http
            .post(target)
            .json(&build_slack_payload(notif))
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
```

In `slack.rs`'s `#[cfg(test)]` module, update `payload_carries_status_and_labels` to wrap the event:

```rust
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
        let v = build_slack_payload(&Notification::single(&ev));
        let text = v["text"].as_str().unwrap();
        assert!(text.contains("FIRING"));
        assert!(text.contains("critical"));
        assert!(text.contains("svc=api"));
        assert_eq!(v["attachments"][0]["color"], "#d00000");
    }

    #[test]
    fn batch_payload_summarizes_count() {
        let mk = |inst: &str| Event {
            tenant: TenantId(Uuid::nil()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey(inst.into()),
            status: EventStatus::Firing,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
        };
        let notif = Notification {
            group_key: "rule=r,severity=warning".into(),
            events: vec![mk("a"), mk("b")],
        };
        let v = build_slack_payload(&notif);
        assert!(v["text"].as_str().unwrap().contains("2 alerts"));
        assert_eq!(v["attachments"].as_array().unwrap().len(), 2);
    }
```

Add `use crate::notify::Notification;` to the test module `use super::*;` already re-exports it, so no extra import is needed.

- [ ] **Step 7: Update PagerDuty to loop the batch**

In `crates/dispatcher/src/pagerduty.rs`, change `use crate::notify::{Notifier, NotifyError};` to `use crate::notify::{Notification, Notifier, NotifyError};`. Leave `build_pagerduty_payload(routing_key, ev)` unchanged (PD is per-incident). Replace `Notifier::send` to loop over events:

```rust
    async fn send(&self, target: &str, notif: &Notification) -> Result<(), NotifyError> {
        // PagerDuty incidents are keyed per-instance (dedup_key), so a batch is sent
        // as one Events-API call per event. PD's own dedup makes a batch-retry (which
        // may re-send already-delivered events) idempotent for both trigger and resolve.
        for ev in &notif.events {
            let resp = self
                .http
                .post(&self.base_url)
                .json(&build_pagerduty_payload(target, ev))
                .send()
                .await
                .map_err(|e| NotifyError::Transient(e.to_string()))?;
            let status = resp.status();
            if status.is_success() {
                continue;
            } else if status.as_u16() == 429 {
                return Err(NotifyError::Transient("rate limited (429)".into()));
            } else if status.is_client_error() {
                return Err(NotifyError::Permanent(format!("status {status}")));
            } else {
                return Err(NotifyError::Transient(format!("status {status}")));
            }
        }
        Ok(())
    }
```

The existing `#[cfg(test)]` module tests `build_pagerduty_payload` directly and needs no change.

- [ ] **Step 8: Update email to render a batch**

In `crates/dispatcher/src/email.rs`, change `use crate::notify::{Notifier, NotifyError};` to `use crate::notify::{Notification, Notifier, NotifyError};`. Replace `build_email_message` and `Notifier::send`:

```rust
/// Build a plaintext email for a notification (one or more events). A bad `from`/`to`
/// address or empty recipient list is a Permanent error (misconfiguration, not worth
/// retrying).
pub fn build_email_message(
    from: &str,
    to: &[String],
    notif: &Notification,
) -> Result<Message, NotifyError> {
    if to.is_empty() {
        return Err(NotifyError::Permanent("no recipients".into()));
    }
    let n = notif.events.len();
    let subject = if n == 1 {
        let ev = &notif.events[0];
        let status = match ev.status {
            EventStatus::Firing => "FIRING",
            EventStatus::Resolved => "RESOLVED",
        };
        format!("[{status}] {} {}", severity_str(ev.severity), ev.instance_key.0)
    } else {
        format!("[{n} alerts] {}", notif.group_key)
    };
    let mut body = format!("group: {}\nalerts: {n}\n\n", notif.group_key);
    for ev in &notif.events {
        let status = match ev.status {
            EventStatus::Firing => "firing",
            EventStatus::Resolved => "resolved",
        };
        body.push_str(&format!(
            "- status: {}\n  severity: {}\n  instance: {}\n",
            status,
            severity_str(ev.severity),
            ev.instance_key.0
        ));
        for (k, v) in &ev.labels {
            body.push_str(&format!("  {k}: {v}\n"));
        }
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
```

```rust
    async fn send(&self, target: &str, notif: &Notification) -> Result<(), NotifyError> {
        let recipients: Vec<String> = target
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let msg = build_email_message(&self.from, &recipients, notif)?;
        self.transport
            .send(msg)
            .await
            .map(|_| ())
            .map_err(|e| NotifyError::Transient(e.to_string()))
    }
```

In `email.rs`'s `#[cfg(test)]` module, replace the `ev()` helper return with a notification wrapper and update both tests:

```rust
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
        let msg =
            build_email_message("from@x.test", &["a@x.test".into()], &Notification::single(&ev()))
                .unwrap();
        let formatted = String::from_utf8(msg.formatted()).unwrap();
        assert!(formatted.contains("Subject: [FIRING] warning svc=api"));
        assert!(formatted.contains("To: a@x.test"));
        assert!(formatted.contains("svc: api"));
    }

    #[test]
    fn empty_recipients_is_permanent() {
        let err = build_email_message("from@x.test", &[], &Notification::single(&ev())).unwrap_err();
        assert!(matches!(err, NotifyError::Permanent(_)));
    }
```

`Notification` is in scope via `use super::*;`.

- [ ] **Step 9: Update the channel `_it.rs` direct-`send` tests**

These integration tests call `notifier.send(target, &ev)` directly. Wrap each event in a `Notification`. Add `use cc_dispatcher::notify::Notification;` (or `use cc_dispatcher::Notification;` after Task 5 re-exports it — for now use the `notify::` path) to each file and change the calls.

`crates/dispatcher/tests/webhook_it.rs` — add the import and change lines 52, 61, 70 from `n.send(&url, &ev())` / `n.send(&bad, &ev())` to wrap: `n.send(&url, &Notification::single(&ev())).await...`. Keep the surrounding `.await.unwrap()` / `.unwrap_err()`.

`crates/dispatcher/tests/slack_it.rs` — add the import; change lines 53, 62: `SlackNotifier::new().send(&url, &Notification::single(&ev())).await...`.

`crates/dispatcher/tests/pagerduty_it.rs` — add the import; change line 50: `n.send("routing-key-123", &Notification::single(&ev)).await.unwrap();`.

`crates/dispatcher/tests/email_it.rs` — add the import; change line 41: `notifier.send("oncall@x.test", &Notification::single(&ev())).await.unwrap();`. (Line 47 `client.get(&api).send()` is reqwest — leave it.)

For each file, run its test after editing, e.g.:
Run: `cargo test -p cc-dispatcher --test webhook_it`
Expected: PASS.

- [ ] **Step 10: Update `dispatch_it.rs` and `e2e_dispatch.rs` payload assertions**

The webhook payload is now `{group_key, events:[…]}`, so the firehose assertions must read into `events[0]`.

`crates/dispatcher/tests/dispatch_it.rs` — the `start_webhook` stub counts hits and does not inspect the body, so **no change** is needed here for Task 1. (Its `run_dispatcher` call and `dedup_key` assertion are updated in Task 5.)

`tests/e2e_dispatch.rs` — the stub captures the JSON body. Change the assertion block (lines ~127-132) from reading top-level fields to reading the wrapped event:

```rust
    {
        let got = captured.lock().unwrap();
        assert_eq!(got.len(), 1, "exactly one webhook delivery");
        assert_eq!(got[0]["events"][0]["status"], "firing");
        assert_eq!(got[0]["events"][0]["labels"]["service"], "api");
    } // drop MutexGuard before any await points
```

(The `run_dispatcher` call signature in this file is updated in Task 5.)

- [ ] **Step 11: Verify the whole crate + clippy**

Run: `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`
Expected: clean.
Run: `cargo test -p cc-dispatcher --lib`
Expected: PASS (notify, retry, slack, pagerduty, email unit tests).

- [ ] **Step 12: Commit**

```bash
git add crates/dispatcher/src/notify.rs crates/dispatcher/src/retry.rs \
  crates/dispatcher/src/slack.rs crates/dispatcher/src/pagerduty.rs crates/dispatcher/src/email.rs \
  crates/dispatcher/tests/webhook_it.rs crates/dispatcher/tests/slack_it.rs \
  crates/dispatcher/tests/pagerduty_it.rs crates/dispatcher/tests/email_it.rs \
  tests/e2e_dispatch.rs
git commit -m "feat(dispatcher): batch notifications via Notification{group_key,events}"
```

---

## Task 2: Route grouping fields (domain + migration + store + API)

**Files:**
- Modify: `crates/domain/src/routing.rs`
- Create: `migrations/0004_grouping.sql`
- Modify: `crates/stores/src/pg.rs:442-496` (`create_route`, `routes_for`)
- Modify: `crates/api/src/routes.rs`
- Modify (call sites): `crates/stores/tests/routing_it.rs:54,58`, `crates/dispatcher/tests/routing_dispatch_it.rs:82`, `tests/e2e_routing.rs:87,101`

- [ ] **Step 1: Write the failing domain test for new `Route` fields**

In `crates/domain/src/routing.rs`, add a test to the `#[cfg(test)]` module:

```rust
    #[test]
    fn route_grouping_fields_default_to_none() {
        let json = serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000000",
            "tenant": "00000000-0000-0000-0000-000000000000",
            "matchers": [],
            "receiver": "ops"
        });
        let r: Route = serde_json::from_value(json).unwrap();
        assert_eq!(r.group_by, None);
        assert_eq!(r.group_wait_secs, None);
        assert_eq!(r.group_interval_secs, None);
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p cc-domain routing`
Expected: FAIL to compile — `no field group_by on type Route`.

- [ ] **Step 3: Add the fields to `Route`**

In `crates/domain/src/routing.rs`, extend the `Route` struct (after the `priority` field):

```rust
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
    /// Label names to group active alerts by. `None` → dispatcher default `["rule","severity"]`.
    #[serde(default)]
    pub group_by: Option<Vec<String>>,
    /// Seconds to hold a new group before its first flush. `None` → default 10.
    #[serde(default)]
    pub group_wait_secs: Option<u32>,
    /// Minimum seconds between successive flushes of an existing group. `None` → default 300.
    #[serde(default)]
    pub group_interval_secs: Option<u32>,
}
```

The existing `route_uses_continue_json_key` test constructs a `Route` literal — add the three new fields to it:

```rust
            receiver: "pd".into(),
            continue_matching: true,
            priority: 0,
            group_by: None,
            group_wait_secs: None,
            group_interval_secs: None,
        };
```

- [ ] **Step 4: Run to verify the domain test passes**

Run: `cargo test -p cc-domain routing`
Expected: PASS.

- [ ] **Step 5: Add the migration**

Create `migrations/0004_grouping.sql`:

```sql
ALTER TABLE routes
    ADD COLUMN group_by            JSONB,
    ADD COLUMN group_wait_secs     INT,
    ADD COLUMN group_interval_secs INT;
```

- [ ] **Step 6: Update `create_route` and `routes_for` in the store**

In `crates/stores/src/pg.rs`, replace `create_route` and `routes_for` (lines 442-496):

```rust
    #[allow(clippy::too_many_arguments)]
    pub async fn create_route(
        &self,
        tenant: TenantId,
        matchers: &[Matcher],
        receiver: &str,
        continue_matching: bool,
        priority: i32,
        group_by: Option<&[String]>,
        group_wait_secs: Option<u32>,
        group_interval_secs: Option<u32>,
    ) -> Result<Route, StoreError> {
        let id = Uuid::new_v4();
        let m_json = serde_json::to_value(matchers)?;
        let gb_json: Option<serde_json::Value> = match group_by {
            Some(g) => Some(serde_json::to_value(g)?),
            None => None,
        };
        sqlx::query(
            "INSERT INTO routes
               (id, tenant, matchers, receiver, continue_matching, priority,
                group_by, group_wait_secs, group_interval_secs)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(id)
        .bind(tenant.0)
        .bind(&m_json)
        .bind(receiver)
        .bind(continue_matching)
        .bind(priority)
        .bind(&gb_json)
        .bind(group_wait_secs.map(|v| v as i32))
        .bind(group_interval_secs.map(|v| v as i32))
        .execute(&self.pool)
        .await?;
        Ok(Route {
            id,
            tenant,
            matchers: matchers.to_vec(),
            receiver: receiver.to_string(),
            continue_matching,
            priority,
            group_by: group_by.map(|g| g.to_vec()),
            group_wait_secs,
            group_interval_secs,
        })
    }

    /// All routes for a tenant, in evaluation order (priority asc, then creation order).
    pub async fn routes_for(&self, tenant: TenantId) -> Result<Vec<Route>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, matchers, receiver, continue_matching, priority,
                    group_by, group_wait_secs, group_interval_secs
             FROM routes WHERE tenant=$1 ORDER BY priority ASC, created_at ASC",
        )
        .bind(tenant.0)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::new();
        for r in &rows {
            let matchers: Vec<Matcher> = serde_json::from_value(r.get("matchers"))?;
            let group_by: Option<Vec<String>> =
                match r.get::<Option<serde_json::Value>, _>("group_by") {
                    Some(v) => Some(serde_json::from_value(v)?),
                    None => None,
                };
            out.push(Route {
                id: r.get("id"),
                tenant: TenantId(r.get("tenant")),
                matchers,
                receiver: r.get("receiver"),
                continue_matching: r.get("continue_matching"),
                priority: r.get("priority"),
                group_by,
                group_wait_secs: r.get::<Option<i32>, _>("group_wait_secs").map(|v| v as u32),
                group_interval_secs: r
                    .get::<Option<i32>, _>("group_interval_secs")
                    .map(|v| v as u32),
            });
        }
        Ok(out)
    }
```

- [ ] **Step 7: Update the API `CreateRoute` body and handler**

In `crates/api/src/routes.rs`, extend `CreateRoute` and the `create_route` call:

```rust
#[derive(Deserialize)]
pub struct CreateRoute {
    pub matchers: Vec<Matcher>,
    pub receiver: String,
    #[serde(rename = "continue", default)]
    pub continue_matching: bool,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub group_by: Option<Vec<String>>,
    #[serde(default)]
    pub group_wait_secs: Option<u32>,
    #[serde(default)]
    pub group_interval_secs: Option<u32>,
}
```

In `create`, replace the `state.store.create_route(...)` call:

```rust
    let route = state
        .store
        .create_route(
            t,
            &body.matchers,
            &body.receiver,
            body.continue_matching,
            body.priority,
            body.group_by.as_deref(),
            body.group_wait_secs,
            body.group_interval_secs,
        )
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
```

- [ ] **Step 8: Update the three test call sites of `create_route`**

`crates/stores/tests/routing_it.rs` lines 54 and 58 — append `, None, None, None`:

```rust
        .create_route(tenant, &[matcher("severity", "warning")], "ops", true, 10, None, None, None)
```
```rust
        .create_route(tenant, &[matcher("severity", "critical")], "pd", false, 1, None, None, None)
```

`crates/dispatcher/tests/routing_dispatch_it.rs` line 82 — the call spans multiple lines ending `, "ops", false, 0,`. Add the three args before the closing `)`:

```rust
        .create_route(
            tenant,
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            "ops",
            false,
            0,
            None,
            Some(0),
            None,
        )
```

(Using `group_wait_secs = Some(0)` so this test's group flushes on the first sweep — relevant once Task 5 wires grouping; harmless now.)

`tests/e2e_routing.rs` lines 87 and 101 — both `create_route(...)` calls. Append `, None, Some(0), None` to each (before the closing paren of each call). Locate each call's trailing positional args (`receiver, continue, priority`) and add the three grouping args after `priority`.

- [ ] **Step 9: Run the affected suites**

Run: `cargo test -p cc-domain routing && cargo test -p cc-stores --test routing_it`
Expected: PASS (domain unit; store integration creates routes with NULL grouping columns and reads them back as `None`).
Run: `cargo clippy -p cc-stores -p cc-api -p cc-domain --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add crates/domain/src/routing.rs migrations/0004_grouping.sql crates/stores/src/pg.rs \
  crates/api/src/routes.rs crates/stores/tests/routing_it.rs \
  crates/dispatcher/tests/routing_dispatch_it.rs tests/e2e_routing.rs
git commit -m "feat(routing): per-route group_by/group_wait/group_interval"
```

---

## Task 3: Pure grouping functions

**Files:**
- Create: `crates/dispatcher/src/grouping.rs`
- Modify: `crates/dispatcher/src/routing.rs` (add `GroupingParams`, `MatchedTarget`, `select_grouping_targets`)
- Modify: `crates/dispatcher/src/lib.rs` (`pub mod grouping;`)

- [ ] **Step 1: Write the failing tests for `grouping.rs`**

Create `crates/dispatcher/src/grouping.rs`:

```rust
use cc_domain::ids::TenantId;
use cc_domain::Event;
use std::collections::BTreeMap;

/// Default label names to group by when a route does not specify `group_by`.
/// Tenant and receiver are always implicit in the group identity.
pub fn default_group_by() -> Vec<String> {
    vec!["rule".to_string(), "severity".to_string()]
}

pub const DEFAULT_GROUP_WAIT_SECS: u32 = 10;
pub const DEFAULT_GROUP_INTERVAL_SECS: u32 = 300;

/// Resolve the group-by label values from a matchable label set (see
/// `routing::match_labels`). A missing label resolves to the empty string so a group
/// is still well-defined. Returns pairs in the order of `group_by`.
pub fn group_by_values(
    labels: &BTreeMap<String, String>,
    group_by: &[String],
) -> Vec<(String, String)> {
    group_by
        .iter()
        .map(|k| {
            (
                k.clone(),
                labels.get(k).cloned().unwrap_or_default(),
            )
        })
        .collect()
}

/// Human-readable group key: `receiver|k1=v1,k2=v2` (values in `group_by` order).
pub fn group_key_string(receiver: &str, values: &[(String, String)]) -> String {
    let body = values
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("{receiver}|{body}")
}

/// Stable opaque group id (hex sha256) over tenant + receiver + the group-by names and
/// values. Distinct group_by configs for the same receiver yield distinct ids.
pub fn group_id(
    tenant: TenantId,
    receiver: &str,
    group_by: &[String],
    values: &[(String, String)],
) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(tenant.0.as_bytes());
    h.update(b"\x00");
    h.update(receiver.as_bytes());
    h.update(b"\x00");
    for name in group_by {
        h.update(name.as_bytes());
        h.update(b"\x01");
    }
    h.update(b"\x00");
    for (k, v) in values {
        h.update(k.as_bytes());
        h.update(b"\x01");
        h.update(v.as_bytes());
        h.update(b"\x02");
    }
    hex::encode(h.finalize())
}

/// Per-event fingerprint within a group: the instance key. A later event for the same
/// instance (e.g. a resolve) overwrites the earlier one in the active set.
pub fn fingerprint(ev: &Event) -> String {
    ev.instance_key.0.clone()
}

/// Dedup key for one group notification = hash(group_id, channel, target, active set).
/// The active set is folded in as sorted (instance, status, eval_ts) so a changed set
/// yields a new key (a new notification) while a redelivery of the identical set does not.
pub fn group_dedup_key(group_id: &str, channel: &str, target: &str, events: &[Event]) -> String {
    use cc_domain::EventStatus;
    use sha2::{Digest, Sha256};
    let mut parts: Vec<(String, &'static str, i128)> = events
        .iter()
        .map(|e| {
            (
                e.instance_key.0.clone(),
                match e.status {
                    EventStatus::Firing => "firing",
                    EventStatus::Resolved => "resolved",
                },
                e.eval_ts.unix_timestamp_nanos(),
            )
        })
        .collect();
    parts.sort();
    let mut h = Sha256::new();
    h.update(group_id.as_bytes());
    h.update(b"\x00");
    h.update(channel.as_bytes());
    h.update(b"\x00");
    h.update(target.as_bytes());
    h.update(b"\x00");
    for (inst, status, ts) in &parts {
        h.update(inst.as_bytes());
        h.update(b"\x01");
        h.update(status.as_bytes());
        h.update(b"\x01");
        h.update(ts.to_be_bytes());
        h.update(b"\x02");
    }
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_domain::event::{Event, EventStatus};
    use cc_domain::ids::{InstanceKey, RuleId, TenantId};
    use cc_domain::rule::Severity;
    use std::collections::BTreeMap;
    use time::{Duration, OffsetDateTime};
    use uuid::Uuid;

    fn ev(inst: &str, status: EventStatus, secs: i64) -> Event {
        Event {
            tenant: TenantId(Uuid::nil()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey(inst.into()),
            status,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH + Duration::seconds(secs),
        }
    }

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn values_follow_group_by_order_and_default_empty() {
        let l = labels(&[("severity", "critical")]);
        let gb = vec!["rule".to_string(), "severity".to_string()];
        assert_eq!(
            group_by_values(&l, &gb),
            vec![("rule".to_string(), String::new()), ("severity".to_string(), "critical".to_string())]
        );
    }

    #[test]
    fn group_id_changes_with_values_and_receiver() {
        let gb = default_group_by();
        let v1 = group_by_values(&labels(&[("rule", "r"), ("severity", "warning")]), &gb);
        let v2 = group_by_values(&labels(&[("rule", "r"), ("severity", "critical")]), &gb);
        let t = TenantId(Uuid::nil());
        assert_ne!(group_id(t, "ops", &gb, &v1), group_id(t, "ops", &gb, &v2));
        assert_ne!(group_id(t, "ops", &gb, &v1), group_id(t, "pd", &gb, &v1));
        assert_eq!(group_id(t, "ops", &gb, &v1), group_id(t, "ops", &gb, &v1));
    }

    #[test]
    fn dedup_key_order_independent_but_set_sensitive() {
        let a = ev("a", EventStatus::Firing, 0);
        let b = ev("b", EventStatus::Firing, 0);
        let k1 = group_dedup_key("g", "webhook", "u", &[a.clone(), b.clone()]);
        let k2 = group_dedup_key("g", "webhook", "u", &[b.clone(), a.clone()]);
        assert_eq!(k1, k2, "order of the active set must not matter");
        let k3 = group_dedup_key("g", "webhook", "u", &[a.clone()]);
        assert_ne!(k1, k3, "different active set → different key");
        let a_resolved = ev("a", EventStatus::Resolved, 0);
        let k4 = group_dedup_key("g", "webhook", "u", &[a_resolved, b]);
        assert_ne!(k1, k4, "status change → different key");
    }

    #[test]
    fn fingerprint_is_instance_key() {
        assert_eq!(fingerprint(&ev("svc=api", EventStatus::Firing, 0)), "svc=api");
    }
}
```

- [ ] **Step 2: Wire the module and run to verify it fails then passes**

In `crates/dispatcher/src/lib.rs`, add to the module list (alphabetical, after `email`):

```rust
pub mod grouping;
```

Run: `cargo test -p cc-dispatcher --lib grouping`
Expected: PASS (the module is self-contained; if you ran it before adding `pub mod grouping;` it would fail to find the tests — confirm the red→green by running once before wiring if desired).

- [ ] **Step 3: Write the failing test for `select_grouping_targets`**

In `crates/dispatcher/src/routing.rs`, add to the `#[cfg(test)]` module (and update the `route(...)` helper to set the new fields — see Step 5):

```rust
    #[test]
    fn grouping_targets_apply_defaults_and_dedup_by_receiver() {
        let labels = match_labels(&ev(Severity::Critical, &[("svc", "api")]));
        let mut r1 = route("ops", true, vec![m("severity", MatchOp::Eq, "critical")]);
        r1.group_wait_secs = Some(3);
        let r2 = route("ops", false, vec![m("svc", MatchOp::Eq, "api")]); // same receiver again
        let targets = select_grouping_targets(&[r1, r2], &labels);
        assert_eq!(targets.len(), 1, "receiver deduped, first match wins");
        assert_eq!(targets[0].receiver, "ops");
        assert_eq!(targets[0].grouping.group_wait_secs, 3);
        assert_eq!(targets[0].grouping.group_interval_secs, 300);
        assert_eq!(targets[0].grouping.group_by, vec!["rule".to_string(), "severity".to_string()]);
    }
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cargo test -p cc-dispatcher --lib routing`
Expected: FAIL to compile — `cannot find function select_grouping_targets`.

- [ ] **Step 5: Implement `select_grouping_targets` and update the test helper**

In `crates/dispatcher/src/routing.rs`, add imports and the new types/function near the top (after the existing `use` lines add `use crate::grouping;` and `use cc_domain::routing::Route;` is already imported):

```rust
/// Resolved grouping parameters for one matched receiver (route defaults applied).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupingParams {
    pub group_by: Vec<String>,
    pub group_wait_secs: u32,
    pub group_interval_secs: u32,
}

/// A receiver selected for an event, with its grouping parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchedTarget {
    pub receiver: String,
    pub grouping: GroupingParams,
}

/// Like `select_receivers`, but returns each unique receiver (first-match order) paired
/// with the grouping parameters from the FIRST route that selected it (route defaults
/// applied). `continue` semantics match `select_receivers`.
pub fn select_grouping_targets(
    routes: &[Route],
    labels: &BTreeMap<String, String>,
) -> Vec<MatchedTarget> {
    let mut out: Vec<MatchedTarget> = Vec::new();
    for r in routes {
        if route_matches(r, labels) {
            if !out.iter().any(|t| t.receiver == r.receiver) {
                out.push(MatchedTarget {
                    receiver: r.receiver.clone(),
                    grouping: GroupingParams {
                        group_by: r
                            .group_by
                            .clone()
                            .unwrap_or_else(grouping::default_group_by),
                        group_wait_secs: r
                            .group_wait_secs
                            .unwrap_or(grouping::DEFAULT_GROUP_WAIT_SECS),
                        group_interval_secs: r
                            .group_interval_secs
                            .unwrap_or(grouping::DEFAULT_GROUP_INTERVAL_SECS),
                    },
                });
            }
            if !r.continue_matching {
                break;
            }
        }
    }
    out
}
```

Update the `route(...)` test helper in the same `#[cfg(test)]` module to set the new fields:

```rust
    fn route(receiver: &str, cont: bool, matchers: Vec<Matcher>) -> Route {
        Route {
            id: Uuid::nil(),
            tenant: TenantId(Uuid::nil()),
            matchers,
            receiver: receiver.into(),
            continue_matching: cont,
            priority: 0,
            group_by: None,
            group_wait_secs: None,
            group_interval_secs: None,
        }
    }
```

- [ ] **Step 6: Run to verify it passes**

Run: `cargo test -p cc-dispatcher --lib routing grouping`
Expected: PASS (all routing + grouping unit tests).
Run: `cargo clippy -p cc-dispatcher --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crates/dispatcher/src/grouping.rs crates/dispatcher/src/routing.rs crates/dispatcher/src/lib.rs
git commit -m "feat(dispatcher): pure grouping keys and target selection"
```

---

## Task 4: `GroupStore` + `RedisGroups` (Redis-backed buffer + timers)

**Files:**
- Create: `crates/queue/src/groups.rs`
- Modify: `crates/queue/src/lib.rs` (`pub mod groups;` + re-exports)
- Modify: `crates/queue/Cargo.toml` (add `uuid` dependency)
- Create: `crates/queue/tests/groups_it.rs`

- [ ] **Step 1: Add the `uuid` dependency to the queue crate**

In `crates/queue/Cargo.toml`, under `[dependencies]` add:

```toml
uuid = { workspace = true }
```

(It is already in `[dev-dependencies]`; `GroupMeta` needs it in the library.)

- [ ] **Step 2: Write `groups.rs` with the trait, types, and Lua-backed impl**

Create `crates/queue/src/groups.rs`:

```rust
use crate::QueueError;
use async_trait::async_trait;
use cc_domain::Event;
use redis::aio::ConnectionManager;
use redis::Script;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const FLUSH_ZSET: &str = "cc:groupflush";
/// Group hashes expire if untouched for this long (bounds storage for silent groups).
const GROUP_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

fn group_key(group_id: &str) -> String {
    format!("cc:group:{group_id}")
}

/// Stored once per group (first event wins via HSETNX). Carries everything the flusher
/// needs without re-reading Postgres: the resolved channel/target and the human group key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupMeta {
    pub tenant: Uuid,
    pub channel: String,
    pub target: String,
    pub group_key: String,
}

/// Redis-backed group buffer + flush-timer store. Membership lives in a hash
/// `cc:group:{id}` (field `ev:{instance}` → event JSON, plus `__meta__`/`__last_flush__`);
/// flush times live in a ZSET `cc:groupflush`. All mutations are atomic Lua so any
/// dispatcher replica can buffer and flush without sticky ownership.
#[async_trait]
pub trait GroupStore: Send + Sync {
    /// Buffer `ev` into `group_id` (overwriting any prior event for the same instance)
    /// and arm a flush. New group → due = now + group_wait. Previously-flushed group →
    /// due = max(now, last_flush + group_interval). A group already armed is left as-is.
    async fn add_to_group(
        &self,
        group_id: &str,
        meta: &GroupMeta,
        fingerprint: &str,
        ev: &Event,
        now_ms: i64,
        group_wait_ms: i64,
        group_interval_ms: i64,
    ) -> Result<(), QueueError>;

    /// Atomically claim (remove from the timer) up to `max` group ids whose flush is due
    /// (score <= now_ms). Each id is then owned by this caller for flushing.
    async fn claim_due(&self, now_ms: i64, max: usize) -> Result<Vec<String>, QueueError>;

    /// Snapshot a claimed group's meta + active events, atomically clearing the event
    /// fields and stamping `__last_flush__ = now_ms` (so re-arrivals form a new batch).
    /// Returns None if the group has no metadata (already taken / expired).
    async fn take_group(
        &self,
        group_id: &str,
        now_ms: i64,
    ) -> Result<Option<(GroupMeta, Vec<Event>)>, QueueError>;
}

pub struct RedisGroups {
    conn: ConnectionManager,
}

impl RedisGroups {
    pub async fn connect(url: &str) -> Result<Self, QueueError> {
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self { conn })
    }
}

const ADD_LUA: &str = r#"
redis.call('HSET', KEYS[1], 'ev:'..ARGV[2], ARGV[3])
redis.call('HSETNX', KEYS[1], '__meta__', ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[8])
local armed = redis.call('ZSCORE', KEYS[2], ARGV[1])
if not armed then
  local last = redis.call('HGET', KEYS[1], '__last_flush__')
  local due
  if last then
    due = tonumber(last) + tonumber(ARGV[7])
    local floor = tonumber(ARGV[5])
    if due < floor then due = floor end
  else
    due = tonumber(ARGV[5]) + tonumber(ARGV[6])
  end
  redis.call('ZADD', KEYS[2], due, ARGV[1])
end
return 1
"#;

const CLAIM_LUA: &str = r#"
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for i=1,#due do redis.call('ZREM', KEYS[1], due[i]) end
return due
"#;

const TAKE_LUA: &str = r#"
local all = redis.call('HGETALL', KEYS[1])
for i=1,#all,2 do
  if string.sub(all[i],1,3) == 'ev:' then
    redis.call('HDEL', KEYS[1], all[i])
  end
end
redis.call('HSET', KEYS[1], '__last_flush__', ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return all
"#;

#[async_trait]
impl GroupStore for RedisGroups {
    async fn add_to_group(
        &self,
        group_id: &str,
        meta: &GroupMeta,
        fingerprint: &str,
        ev: &Event,
        now_ms: i64,
        group_wait_ms: i64,
        group_interval_ms: i64,
    ) -> Result<(), QueueError> {
        let ev_json = serde_json::to_string(ev)?;
        let meta_json = serde_json::to_string(meta)?;
        let mut conn = self.conn.clone();
        let _: i64 = Script::new(ADD_LUA)
            .key(group_key(group_id))
            .key(FLUSH_ZSET)
            .arg(group_id)
            .arg(fingerprint)
            .arg(ev_json)
            .arg(meta_json)
            .arg(now_ms)
            .arg(group_wait_ms)
            .arg(group_interval_ms)
            .arg(GROUP_TTL_MS)
            .invoke_async(&mut conn)
            .await?;
        Ok(())
    }

    async fn claim_due(&self, now_ms: i64, max: usize) -> Result<Vec<String>, QueueError> {
        let mut conn = self.conn.clone();
        let ids: Vec<String> = Script::new(CLAIM_LUA)
            .key(FLUSH_ZSET)
            .arg(now_ms)
            .arg(max as i64)
            .invoke_async(&mut conn)
            .await?;
        Ok(ids)
    }

    async fn take_group(
        &self,
        group_id: &str,
        now_ms: i64,
    ) -> Result<Option<(GroupMeta, Vec<Event>)>, QueueError> {
        let mut conn = self.conn.clone();
        let flat: Vec<String> = Script::new(TAKE_LUA)
            .key(group_key(group_id))
            .arg(now_ms)
            .arg(GROUP_TTL_MS)
            .invoke_async(&mut conn)
            .await?;
        let mut meta: Option<GroupMeta> = None;
        let mut events: Vec<Event> = Vec::new();
        let mut i = 0;
        while i + 1 < flat.len() {
            let k = &flat[i];
            let v = &flat[i + 1];
            if k == "__meta__" {
                meta = Some(serde_json::from_str(v)?);
            } else if let Some(_inst) = k.strip_prefix("ev:") {
                events.push(serde_json::from_str(v)?);
            }
            i += 2;
        }
        Ok(meta.map(|m| (m, events)))
    }
}
```

- [ ] **Step 3: Re-export from the queue crate**

In `crates/queue/src/lib.rs`, add after the existing `pub mod` lines at the top:

```rust
pub mod groups;
```

and after the existing re-exports (if any) it is sufficient that `groups` is public. No struct re-export needed; consumers use `cc_queue::groups::{GroupStore, GroupMeta, RedisGroups}`.

- [ ] **Step 4: Write the failing integration test**

Create `crates/queue/tests/groups_it.rs`:

```rust
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::rule::Severity;
use cc_queue::groups::{GroupMeta, GroupStore, RedisGroups};
use std::collections::BTreeMap;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

fn ev(inst: &str, status: EventStatus) -> Event {
    Event {
        tenant: TenantId(Uuid::nil()),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey(inst.into()),
        status,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

fn meta() -> GroupMeta {
    GroupMeta {
        tenant: Uuid::nil(),
        channel: "webhook".into(),
        target: "http://x/hook".into(),
        group_key: "ops|rule=,severity=warning".into(),
    }
}

#[tokio::test]
async fn buffers_batches_and_claims_when_due() {
    let redis = Redis::default().start().await.unwrap();
    let url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );
    let groups = RedisGroups::connect(&url).await.unwrap();

    let now = 1_000_000i64;
    // New group, group_wait = 50ms → due at now+50.
    groups
        .add_to_group("g1", &meta(), "a", &ev("a", EventStatus::Firing), now, 50, 5000)
        .await
        .unwrap();
    // Second event joins the same already-armed group (does not push the timer out).
    groups
        .add_to_group("g1", &meta(), "b", &ev("b", EventStatus::Firing), now + 10, 50, 5000)
        .await
        .unwrap();

    // Not due yet.
    assert!(groups.claim_due(now + 10, 16).await.unwrap().is_empty());

    // Due now.
    let claimed = groups.claim_due(now + 100, 16).await.unwrap();
    assert_eq!(claimed, vec!["g1".to_string()]);

    // A second claim finds nothing (timer was removed atomically).
    assert!(groups.claim_due(now + 100, 16).await.unwrap().is_empty());

    // take_group returns meta + both active events, then clears them.
    let (m, mut events) = groups.take_group("g1", now + 100).await.unwrap().unwrap();
    assert_eq!(m.channel, "webhook");
    events.sort_by(|x, y| x.instance_key.0.cmp(&y.instance_key.0));
    let insts: Vec<String> = events.iter().map(|e| e.instance_key.0.clone()).collect();
    assert_eq!(insts, vec!["a".to_string(), "b".to_string()]);

    // After take, the group has no events; a re-take yields meta with empty events.
    let (_m2, after) = groups.take_group("g1", now + 200).await.unwrap().unwrap();
    assert!(after.is_empty());
}

#[tokio::test]
async fn previously_flushed_group_rearms_after_interval() {
    let redis = Redis::default().start().await.unwrap();
    let url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );
    let groups = RedisGroups::connect(&url).await.unwrap();

    let now = 2_000_000i64;
    groups
        .add_to_group("g2", &meta(), "a", &ev("a", EventStatus::Firing), now, 0, 1000)
        .await
        .unwrap();
    assert_eq!(groups.claim_due(now, 16).await.unwrap(), vec!["g2".to_string()]);
    // Flush stamps __last_flush__ = now.
    groups.take_group("g2", now).await.unwrap();

    // A new event arrives at now+10; group re-arms at last_flush + interval = now+1000.
    groups
        .add_to_group("g2", &meta(), "b", &ev("b", EventStatus::Firing), now + 10, 0, 1000)
        .await
        .unwrap();
    assert!(groups.claim_due(now + 500, 16).await.unwrap().is_empty(), "interval not elapsed");
    assert_eq!(
        groups.claim_due(now + 1000, 16).await.unwrap(),
        vec!["g2".to_string()],
        "due after interval"
    );
}
```

- [ ] **Step 5: Run it to verify it fails, then passes**

Run: `cargo test -p cc-queue --test groups_it`
Expected first (before Step 2/3 complete): FAIL to compile. After implementing: PASS (requires Docker; pulls the Redis image on first run).

- [ ] **Step 6: clippy**

Run: `cargo clippy -p cc-queue --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crates/queue/Cargo.toml crates/queue/src/groups.rs crates/queue/src/lib.rs crates/queue/tests/groups_it.rs
git commit -m "feat(queue): Redis-backed group buffer and flush timers"
```

---

## Task 5: Buffer routed events + group flusher (dispatcher wiring)

**Files:**
- Modify: `crates/dispatcher/src/lib.rs` (rewrite `process_event`, add `run_group_flusher`, extend `run_dispatcher`, re-exports)
- Modify: `crates/dispatcher/Cargo.toml` (no change expected — verify `time` is present; it is)
- Modify (call sites): `crates/dispatcher/tests/dispatch_it.rs`, `crates/dispatcher/tests/routing_dispatch_it.rs`, `tests/e2e_dispatch.rs`, `tests/e2e_routing.rs`, `src/main.rs`

- [ ] **Step 1: Rewrite `crates/dispatcher/src/lib.rs`**

Replace the entire file with:

```rust
pub mod dedup;
pub mod email;
pub mod grouping;
pub mod notify;
pub mod pagerduty;
pub mod registry;
pub mod retry;
pub mod routing;
pub mod slack;

pub use dedup::dedup_key;
pub use email::EmailNotifier;
pub use notify::{Notification, Notifier, NotifyError, WebhookNotifier};
pub use pagerduty::PagerDutyNotifier;
pub use registry::Notifiers;
pub use retry::{backoff_delay, deliver_with_retry};
pub use slack::SlackNotifier;

use cc_domain::ids::TenantId;
use cc_domain::receiver::ChannelConfig;
use cc_domain::Event;
use cc_queue::groups::{GroupMeta, GroupStore};
use cc_queue::{EventBus, EventEntry};
use cc_stores::PgStore;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

const MAX_ATTEMPTS: u32 = 4;
/// How often the flusher polls for due groups when none are immediately ready.
const FLUSH_TICK: Duration = Duration::from_millis(200);

fn now_ms() -> i64 {
    (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

/// Run the dispatcher consume loop until `shutdown` flips true. Routed events are
/// buffered into Redis groups (flushed by `run_group_flusher`); no-routes tenants keep
/// the immediate per-event webhook firehose.
pub async fn run_dispatcher(
    consumer: String,
    store: PgStore,
    bus: Arc<dyn EventBus>,
    notifiers: Arc<Notifiers>,
    groups: Arc<dyn GroupStore>,
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
            let ack_ok = process_event(
                &store,
                bus.as_ref(),
                notifiers.as_ref(),
                groups.as_ref(),
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
    }
    tracing::info!("dispatcher stopped");
}

/// Resolve an event to its delivery plan. Routed events are buffered into their group(s)
/// in Redis and a flush timer is armed; no-routes tenants fall back to the immediate
/// Phase 2a subscription firehose. Returns true if the stream entry is safe to ack
/// (false only when a required input could not be loaded — leaves it in the PEL).
async fn process_event(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    groups: &dyn GroupStore,
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

    if routes.is_empty() {
        return firehose_deliver(store, bus, notifiers, ev, &entry.id).await;
    }

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
    let now = now_ms();
    let mut all_handled = true;

    for target in routing::select_grouping_targets(&routes, &labels) {
        let ch = match by_name.get(&target.receiver) {
            Some(c) => c,
            None => {
                tracing::warn!(receiver = %target.receiver,
                    "route references unknown receiver; skipping");
                continue;
            }
        };
        let values = grouping::group_by_values(&labels, &target.grouping.group_by);
        let gid = grouping::group_id(ev.tenant, &target.receiver, &target.grouping.group_by, &values);
        let group_key = grouping::group_key_string(&target.receiver, &values);
        let meta = GroupMeta {
            tenant: ev.tenant.0,
            channel: ch.channel_name().to_string(),
            target: ch.target(),
            group_key,
        };
        let fp = grouping::fingerprint(ev);
        let wait_ms = target.grouping.group_wait_secs as i64 * 1000;
        let interval_ms = target.grouping.group_interval_secs as i64 * 1000;
        if let Err(e) = groups
            .add_to_group(&gid, &meta, &fp, ev, now, wait_ms, interval_ms)
            .await
        {
            tracing::error!(error = %e, group = %gid,
                "buffering event into group failed; leaving event unacked for reclaim");
            all_handled = false;
        }
    }
    all_handled
}

/// Immediate per-event webhook delivery for tenants with no routes (Phase 2a behavior).
async fn firehose_deliver(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    ev: &Event,
    entry_id: &str,
) -> bool {
    let subs = match store.subscriptions_for(ev.tenant).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, entry_id = %entry_id, tenant = ?ev.tenant,
                "loading subscriptions failed; leaving event unacked in PEL for later reclaim");
            return false;
        }
    };
    let notif = Notification::single(ev);
    let mut all_handled = true;
    for s in subs {
        let channel = "webhook";
        let target = s.webhook_url;
        let key = dedup::dedup_key(channel, &target, ev);
        match store
            .try_begin_notification(&key, ev.tenant, channel, &target)
            .await
        {
            Ok(true) => {}
            Ok(false) => continue,
            Err(e) => {
                tracing::error!(error = %e, "begin notification failed");
                all_handled = false;
                continue;
            }
        }
        deliver_one(store, bus, notifiers, channel, &target, &key, &notif, ev).await;
    }
    all_handled
}

/// The group flusher: every replica claims due groups and delivers each as one batch.
pub async fn run_group_flusher(
    store: PgStore,
    bus: Arc<dyn EventBus>,
    notifiers: Arc<Notifiers>,
    groups: Arc<dyn GroupStore>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        let ids = match groups.claim_due(now_ms(), 32).await {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(error = %e, "claim_due failed");
                Vec::new()
            }
        };
        if ids.is_empty() {
            tokio::select! {
                _ = tokio::time::sleep(FLUSH_TICK) => {}
                _ = shutdown.changed() => {}
            }
            continue;
        }
        for gid in ids {
            flush_group(&store, bus.as_ref(), notifiers.as_ref(), groups, &gid).await;
        }
    }
    tracing::info!("group flusher stopped");
}

async fn flush_group(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    groups: &Arc<dyn GroupStore>,
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
    let notif = Notification {
        group_key: meta.group_key.clone(),
        events,
    };
    let tenant = TenantId(meta.tenant);
    let key = grouping::group_dedup_key(gid, &meta.channel, &meta.target, &notif.events);
    match store
        .try_begin_notification(&key, tenant, &meta.channel, &meta.target)
        .await
    {
        Ok(true) => {}
        Ok(false) => return, // identical active set already delivered
        Err(e) => {
            tracing::error!(error = %e, group = %gid, "begin notification failed");
            return;
        }
    }
    // Representative event for the dead-letter record (the batch shares a group key).
    let rep = notif.events[0].clone();
    deliver_one(store, bus, notifiers, &meta.channel, &meta.target, &key, &notif, &rep).await;
}

/// Shared delivery + bookkeeping: look up the notifier, retry, then record sent/failed
/// and dead-letter on permanent/exhausted failure. `rep` is the event used for the
/// dead-letter record.
async fn deliver_one(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    channel: &str,
    target: &str,
    key: &str,
    notif: &Notification,
    rep: &Event,
) {
    let notifier = match notifiers.get(channel) {
        Some(n) => n,
        None => {
            let reason = format!("no notifier registered for channel '{channel}'");
            if let Err(e) = store.mark_notification_failed(key, 0, &reason).await {
                tracing::error!(error = %e, key = %key, "mark_notification_failed write failed");
            }
            let _ = bus.dead_letter(rep, &reason).await;
            tracing::error!(channel = %channel, "no notifier registered; dead-lettered");
            return;
        }
    };
    match retry::deliver_with_retry(notifier.as_ref(), target, notif, MAX_ATTEMPTS).await {
        Ok(attempts) => {
            if let Err(e) = store.mark_notification_sent(key, attempts).await {
                tracing::error!(error = %e, key = %key,
                    "mark_notification_sent failed; row stuck 'pending' despite successful delivery");
            }
        }
        Err((attempts, err)) => {
            let reason = err.to_string();
            if let Err(e) = store.mark_notification_failed(key, attempts, &reason).await {
                tracing::error!(error = %e, key = %key, "mark_notification_failed write failed");
            }
            match bus.dead_letter(rep, &reason).await {
                Ok(()) => tracing::warn!(channel = %channel, target = %target, error = %err,
                    "notification dead-lettered"),
                Err(e) => tracing::error!(dead_letter_error = %e, original = %err,
                    channel = %channel, target = %target,
                    "delivery failed AND dead-letter write failed"),
            }
        }
    }
}
```

- [ ] **Step 2: Add `cc-queue` group types are already a dependency — verify build**

`cc-dispatcher/Cargo.toml` already depends on `cc-queue`, `cc-stores`, `time`. No manifest change. Build the crate:

Run: `cargo build -p cc-dispatcher`
Expected: FAIL — the test files `dispatch_it.rs`, `routing_dispatch_it.rs` still call `run_dispatcher` with the old 5-arg signature. Fix them in the next steps.

- [ ] **Step 3: Update `dispatch_it.rs` (firehose, now needs a `groups` arg + new dedup is unchanged)**

In `crates/dispatcher/tests/dispatch_it.rs`:
- Add imports: `use cc_dispatcher::{run_dispatcher, Notifiers};` already present; add `use cc_queue::groups::RedisGroups;` and `use std::sync::Arc;` is present.
- The test already starts a Redis container (`redis_url`). Build a `RedisGroups` and pass it. Replace the dispatcher-spawn block (lines ~77-87):

```rust
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);
    let groups: Arc<dyn cc_queue::groups::GroupStore> =
        Arc::new(RedisGroups::connect(&redis_url).await.unwrap());
    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let handle = {
        let store = store.clone();
        let bus = bus.clone();
        let groups = groups.clone();
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifiers, groups, sd_rx).await;
        })
    };
```

This test uses the no-routes firehose (it creates a subscription, no routes), so the per-event `dedup_key("webhook", &url, &ev(tenant))` assertion at the end stays valid. No assertion change needed.

- [ ] **Step 4: Update `routing_dispatch_it.rs` (now a grouped, flushed delivery)**

Routed delivery is now asynchronous via the flusher. In `crates/dispatcher/tests/routing_dispatch_it.rs`:
- Imports: add `use cc_dispatcher::run_group_flusher;` (extend the existing `use cc_dispatcher::{run_dispatcher, Notifiers};` to `use cc_dispatcher::{run_dispatcher, run_group_flusher, Notifiers};`) and `use cc_queue::groups::{GroupStore, RedisGroups};`.
- The `create_route` call already sets `group_wait_secs = Some(0)` (from Task 2 Step 8), so the group flushes on the first sweep.
- Replace the spawn block (lines ~96-107) to start BOTH the dispatcher and the flusher, sharing one `RedisGroups`:

```rust
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let disp = {
        let (store, bus, groups, notifiers, rx) =
            (store.clone(), bus.clone(), groups.clone(), notifiers.clone(), sd_rx.clone());
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifiers, groups, rx).await;
        })
    };
    let flush = {
        let (store, bus, groups, notifiers, rx) =
            (store.clone(), bus.clone(), groups.clone(), notifiers.clone(), sd_rx.clone());
        tokio::spawn(async move {
            run_group_flusher(store, bus, notifiers, groups, rx).await;
        })
    };
```

- Replace the final assertion + shutdown block. The per-event `dedup_key` row no longer exists (grouped delivery uses `group_dedup_key`); assert the webhook was hit once and shut down both tasks:

```rust
    assert_eq!(*hits.lock().unwrap(), 1, "matched receiver delivered once via group flush");

    let _ = sd_tx.send(true);
    let _ = disp.await;
    let _ = flush.await;
```

Remove the now-invalid `use cc_dispatcher::dedup::dedup_key;` import and the `notification_status` assertion lines.

- [ ] **Step 5: Update `tests/e2e_dispatch.rs` (firehose; add `groups` arg)**

In `tests/e2e_dispatch.rs`:
- Add `use cc_queue::groups::{GroupStore, RedisGroups};`.
- Replace the dispatcher-spawn block (lines ~102-110):

```rust
    let disp_handle = {
        let mut reg = Notifiers::new();
        reg.register(Arc::new(WebhookNotifier::new()));
        let notifiers = Arc::new(reg);
        let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());
        let (store, bus, rx) = (store.clone(), bus.clone(), sd_rx.clone());
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifiers, groups, rx).await;
        })
    };
```

(The payload assertion was already updated to `events[0]` in Task 1 Step 10.)

- [ ] **Step 6: Update `tests/e2e_routing.rs` (grouped; add flusher)**

`tests/e2e_routing.rs` exercises routed fan-out (two receivers via a `continue` route). With grouping, both receivers' groups must flush. The `create_route` calls set `group_wait_secs = Some(0)` (Task 2 Step 8).
- Extend imports: `use cc_dispatcher::{run_dispatcher, run_group_flusher, Notifiers};` and `use cc_queue::groups::{GroupStore, RedisGroups};`.
- Replace the dispatcher-spawn block (around line 120-128) to start dispatcher + flusher sharing a `RedisGroups`, mirroring Task 5 Step 4's pattern (two `tokio::spawn`s named `disp` and `flush`).
- At the end, after asserting both webhooks were hit once, shut down and await both handles:

```rust
    let _ = sd_tx.send(true);
    let _ = disp.await;
    let _ = flush.await;
```

(Adjust the existing single-handle await accordingly.)

- [ ] **Step 7: Update `src/main.rs` (spawn the flusher in the dispatcher role)**

In `src/main.rs`:
- Add imports: `use cc_dispatcher::run_group_flusher;` (extend the existing `use cc_dispatcher::{run_dispatcher, Notifiers};`), and `use cc_queue::groups::{GroupStore, RedisGroups};`.
- In the `if run("dispatcher")` block, build a shared `RedisGroups` and spawn both loops. Replace the block body's tail (after the `notifiers` is built) :

```rust
        let notifiers = Arc::new(reg);
        let groups: Arc<dyn GroupStore> =
            Arc::new(RedisGroups::connect(&cfg.redis_url).await?);
        {
            let (store, bus, groups, notifiers, rx) = (
                store.clone(),
                event_bus.clone(),
                groups.clone(),
                notifiers.clone(),
                sd_rx.clone(),
            );
            let consumer = cfg.node_id.clone();
            handles.push(tokio::spawn(async move {
                run_dispatcher(consumer, store, bus, notifiers, groups, rx).await;
            }));
        }
        {
            let (store, bus, groups, notifiers, rx) = (
                store.clone(),
                event_bus.clone(),
                groups.clone(),
                notifiers.clone(),
                sd_rx.clone(),
            );
            handles.push(tokio::spawn(async move {
                run_group_flusher(store, bus, notifiers, groups, rx).await;
            }));
        }
```

(Remove the old single `run_dispatcher` spawn that this replaces.)

- [ ] **Step 8: Build, clippy, and run the affected integration suites**

Run: `cargo build --workspace`
Expected: clean.
Run: `cargo clippy --all-targets -- -D warnings`
Expected: clean.
Run: `cargo test -p cc-dispatcher --test dispatch_it --test routing_dispatch_it`
Expected: PASS (Docker). `dispatch_it` exercises the firehose; `routing_dispatch_it` exercises a grouped flush with `group_wait=0`.

- [ ] **Step 9: Commit**

```bash
git add crates/dispatcher/src/lib.rs crates/dispatcher/tests/dispatch_it.rs \
  crates/dispatcher/tests/routing_dispatch_it.rs tests/e2e_dispatch.rs tests/e2e_routing.rs src/main.rs
git commit -m "feat(dispatcher): buffer routed events into groups and flush as batches"
```

---

## Task 6: End-to-end grouped batching test

**Files:**
- Create: `tests/e2e_grouping.rs`

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e_grouping.rs`. It publishes two firing events for the same group (same `group_by` values) directly to the event bus, with a route whose `group_wait_secs = 1`, and asserts the webhook receives exactly ONE delivery carrying BOTH events.

```rust
use cc_dispatcher::notify::WebhookNotifier;
use cc_dispatcher::{run_dispatcher, run_group_flusher, Notifiers};
use cc_domain::event::{Event, EventStatus};
use cc_domain::ids::{InstanceKey, RuleId, TenantId};
use cc_domain::receiver::ChannelConfig;
use cc_domain::routing::{MatchOp, Matcher};
use cc_domain::rule::Severity;
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

fn ev(tenant: TenantId, rule: RuleId, inst: &str, svc: &str) -> Event {
    Event {
        tenant,
        rule,
        instance_key: InstanceKey(inst.into()),
        status: EventStatus::Firing,
        labels: BTreeMap::from([("svc".to_string(), svc.to_string())]),
        value: Some(1.0),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
    }
}

#[tokio::test]
async fn two_events_batch_into_one_grouped_delivery() {
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
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());

    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    let tenant = TenantId(Uuid::new_v4());
    let rule = RuleId(Uuid::new_v4());
    store
        .create_receiver(tenant, "ops", &ChannelConfig::Webhook { url: hook.clone() })
        .await
        .unwrap();
    // Group all critical alerts together; hold 1s to batch the burst.
    store
        .create_route(
            tenant,
            &[Matcher { label: "severity".into(), op: MatchOp::Eq, value: "critical".into() }],
            "ops",
            false,
            0,
            Some(vec!["severity".to_string()]),
            Some(1),
            None,
        )
        .await
        .unwrap();

    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let disp = {
        let (store, bus, groups, notifiers, rx) =
            (store.clone(), bus.clone(), groups.clone(), notifiers.clone(), sd_rx.clone());
        tokio::spawn(async move {
            run_dispatcher("d1".into(), store, bus, notifiers, groups, rx).await;
        })
    };
    let flush = {
        let (store, bus, groups, notifiers, rx) =
            (store.clone(), bus.clone(), groups.clone(), notifiers.clone(), sd_rx.clone());
        tokio::spawn(async move {
            run_group_flusher(store, bus, notifiers, groups, rx).await;
        })
    };

    // Two distinct instances, same group_by value (severity=critical) → one group.
    bus.publish(&ev(tenant, rule, "svc=api", "api")).await.unwrap();
    bus.publish(&ev(tenant, rule, "svc=web", "web")).await.unwrap();

    // Wait past group_wait (1s) for the flush.
    for _ in 0..60 {
        if !captured.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // Allow a moment to ensure no second delivery sneaks in.
    tokio::time::sleep(Duration::from_millis(500)).await;

    {
        let got = captured.lock().unwrap();
        assert_eq!(got.len(), 1, "the burst is delivered as exactly one grouped notification");
        let events = got[0]["events"].as_array().unwrap();
        assert_eq!(events.len(), 2, "both instances in one batch");
        let mut svcs: Vec<String> = events
            .iter()
            .map(|e| e["labels"]["svc"].as_str().unwrap().to_string())
            .collect();
        svcs.sort();
        assert_eq!(svcs, vec!["api".to_string(), "web".to_string()]);
    }

    let _ = sd_tx.send(true);
    let _ = disp.await;
    let _ = flush.await;
}
```

- [ ] **Step 2: Run it to verify it fails (if implemented out of order) then passes**

Run: `cargo test --test e2e_grouping`
Expected: PASS (Docker; ~2-3s for the group_wait + container startup).

- [ ] **Step 3: Full workspace gate**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: clean.
Run: `cargo test --workspace --no-fail-fast`
Expected: all binaries pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e_grouping.rs
git commit -m "test(e2e): grouped delivery batches a burst into one notification"
```

---

## Final Review

After all six tasks: dispatch a final whole-implementation code review (per subagent-driven-development), then use `superpowers:finishing-a-development-branch`. Verify end-to-end: `cargo clippy --all-targets -- -D warnings` clean and `cargo test --workspace --no-fail-fast` green.

**Cross-task consistency checklist (self-review):**
- `Notifier::send(&self, target, &Notification)` is the only signature in `notify.rs`, `slack.rs`, `pagerduty.rs`, `email.rs`, and `retry.rs`'s test stubs.
- `Notification { group_key, events }` and `Notification::single` defined once in `notify.rs`, re-exported from `lib.rs`.
- `Route` has `group_by/group_wait_secs/group_interval_secs` (all `Option`, `#[serde(default)]`) in `domain/src/routing.rs`; every `Route` literal in tests sets them; `create_route` (9 args) and `routes_for` read/write the columns; migration `0004_grouping.sql` adds them.
- `create_route` call sites all pass 9 args: `pg.rs` (def), `routing_it.rs` (×2), `routes.rs` (API), `routing_dispatch_it.rs`, `e2e_routing.rs` (×2), `e2e_grouping.rs`.
- `run_dispatcher` (6 args incl. `groups`) call sites: `dispatch_it.rs`, `routing_dispatch_it.rs`, `e2e_dispatch.rs`, `e2e_routing.rs`, `e2e_grouping.rs`, `main.rs`.
- `run_group_flusher` spawned wherever routed grouped delivery is exercised: `routing_dispatch_it.rs`, `e2e_routing.rs`, `e2e_grouping.rs`, `main.rs`.
- `grouping::{group_by_values, group_key_string, group_id, fingerprint, group_dedup_key, default_group_by, DEFAULT_GROUP_WAIT_SECS, DEFAULT_GROUP_INTERVAL_SECS}` used consistently by `routing::select_grouping_targets` and `lib.rs`.
- `GroupStore`/`GroupMeta`/`RedisGroups` in `cc_queue::groups`; `add_to_group`/`claim_due`/`take_group` signatures match between trait, impl, `lib.rs`, and `groups_it.rs`.

**Spec coverage (design spec stage 4 "Grouping"):**
- "Group events by configurable `group_by` (default tenant+rule+severity)" → per-route `group_by`, default `["rule","severity"]` (tenant+receiver implicit in `group_id`). ✓
- "Hold `group_wait` to batch a burst" → `add_to_group` arms new groups at `now + group_wait`. ✓
- "`group_interval` between subsequent notifications" → `take_group` stamps `__last_flush__`; re-arm at `max(now, last_flush + group_interval)`. ✓
- "Group timers in a Redis sorted-set; any replica can flush — no sticky ownership" → `cc:groupflush` ZSET + atomic `claim_due` Lua. ✓
- "Dedup = hash(group_key, channel, fingerprint-of-active-set)" → `group_dedup_key` over `group_id`+channel+target+sorted active set; gated by `try_begin_notification`. ✓
- Resolved events flow through the same pipeline (fingerprint = instance key, so a resolve overwrites the firing in the active set). ✓

**Known trade-offs documented in code (not bugs):**
- `take_group` clears the buffer on read; a failed flush dead-letters rather than re-buffering (Phase 3 could add a holding area).
- Channel/target are resolved at buffer time and stored in `GroupMeta`; a receiver edit between buffer and flush uses the older config until the next group forms.
- The no-routes firehose stays immediate per-event (backward compatibility), so it is not affected by grouping.
