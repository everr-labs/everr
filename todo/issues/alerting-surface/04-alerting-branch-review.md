# Alerting branch review findings

Review scope: `origin/main...gio/graphile-alert-engine` at commit `8963616d`,
re-validated against `gio/graphile-alert-engine-no-slos` on 2026-08-09.
The original numbering is preserved, so removed findings leave gaps.
Each finding below carries its state as of 2026-08-16. Where a finding
points at an issue in [`03-alerting-surface-plan.md`](03-alerting-surface-plan.md)
that covered shipped work, that issue is gone and the outcome is in
[`05-what-shipped.md`](05-what-shipped.md) instead.

This document records the verified findings from the runtime, frontend,
security, persistence, migration, and contract review passes. Findings that
depended on preserving legacy alert data were excluded because destructive
migration and data loss are accepted at this stage.

Global evaluation concurrency and tenant fairness remain planned work in
[`../../ideas/alert-evaluation-capacity.md`](../../ideas/alert-evaluation-capacity.md).

## Removed on re-validation (2026-08-09)

- **Findings 1 and 2** (event loss during concurrent group flushing;
  evaluator failures stranding a rule) are fixed on the branch, in commits
  `aed93e7b` and `239d77e6`. The landings are recorded in the Prerequisite
  section of
  [`02-alerting-clickhouse-surface.md`](02-alerting-clickhouse-surface.md).
- **Findings 7, 8 and 14** (SLO validation disagreement, SLO chart query
  allowance, stale SLO budget) applied only to SLOs, which are removed from
  this branch.

## P1: blockers

### 3. Paused rules can continue notifying

**Resolved** by ticket 13. See [`05-what-shipped.md`](05-what-shipped.md).

Pausing changed the definition flag but left firing instances, pending group flushes and repeat notifications active.

### 4. Any organization member can reconfigure or suppress alerting

**Open**, ticket 18, deferred out of the merge gate: it waits for a real RBAC model. Merging ships this risk knowingly.

Files:

- `packages/app/src/data/alerting/delivery/server.ts:36`
- `packages/app/src/data/alerting/silences/server.ts:13`
- `packages/app/src/data/alerting/rules/server.ts:114`
- `packages/app/src/lib/serverFn.ts:5`

Alerting mutations require authentication and an active organization, but do
not require an owner, administrator, or alerting operator permission. A regular
member can replace webhooks, rewrite routes, create a catch-all silence, or
pause monitoring.

Deferred out of the merge gate on 2026-08-09, pending a real RBAC model;
the accepted risk is stated in ticket 18.

Required outcome:

- Define the role or permission needed for alerting administration.
- Enforce it on channels, channel tests, receivers, routes, inhibitions,
  silences, and rule mutations.
- Add server-side authorization coverage. UI visibility is not sufficient.

### 5. Outbound webhook validation is vulnerable to DNS rebinding SSRF

**Open**, ticket 19, deferred out of the merge gate as a non-blocking follow-up. Merging ships this risk knowingly.

File: `packages/app/src/data/alerting/delivery/channel-sender.server.ts:54`

The hostname is resolved during validation and then resolved again by `fetch`
or the Slack sender. A hostname can return a public address during validation
and an internal address during connection.

Deferred out of the merge gate on 2026-08-09 as a non-blocking follow-up;
the accepted risk is stated in ticket 19.

Required outcome:

- Connect to a validated address while retaining the correct TLS server name,
  or use an outbound proxy that enforces the network policy.
- Apply the same protection to generic webhook, Slack, and Discord delivery.
- Add DNS rebinding and redirect tests.

### 6. Failed applies can partially change live alerting state

**Resolved** by ticket 20. See [`05-what-shipped.md`](05-what-shipped.md).

The alert reconciler ignored the transaction executor, so a failed apply left alerting configuration partly changed.

### 9. Organization deletion fails when a rule uses a direct channel

**Resolved** by ticket 21. See [`05-what-shipped.md`](05-what-shipped.md). One integration case stays open on that ticket.

A rule mapped directly to a channel made PostgreSQL reject the organization cleanup on foreign key ordering.

### 10. Routing regexes permit CPU and memory denial of service

**Retired by construction** in ticket 22: the regex ops are removed, so no user pattern reaches `RegExp`. See [`05-what-shipped.md`](05-what-shipped.md).

User-supplied route, silence and inhibition regexes reached `RegExp` through an unbounded process-wide cache.

### 11. Pending rules are reported as OK

**Resolved** by ticket 12. See [`05-what-shipped.md`](05-what-shipped.md).

A rule inside its for-duration reported as OK, because no pending state existed to report.

### 12. Delivery retries can send duplicate notifications

**Part done**, ticket 23: one send twice leaves one `delivery_succeeded` row, but a fan-out has no per-recipient state, so a retry re-sends to recipients that already succeeded.

Files:

- `packages/app/src/server/alerting/delivery/send-delivery.ts:24`
- `packages/app/src/data/alerting/delivery/channel-sender.server.ts:133`

A provider can accept a request before the worker fails to mark the delivery as
sent. The retry sends it again. Telegram fan-out can also partially
succeed, after which `Promise.all` rejects and retries every recipient.

Required outcome:

- Use provider idempotency where available.
- Track recipient-level fan-out state when one logical delivery targets several
  recipients.
- Document the remaining at-least-once behavior.

### 13. Evaluation downsampling can hide exceptional evaluations

**Resolved** by ticket 24. See [`05-what-shipped.md`](05-what-shipped.md).

Even-index downsampling could drop the only breaching or failed evaluation in a range.

### 15. Rule polling stops after the second page is loaded

**Resolved** by ticket 25. See [`05-what-shipped.md`](05-what-shipped.md).

The `refetchInterval` conditional disabled polling once a second page was loaded.

### 16. Expanded preview alerts request live history

**Resolved** by ticket 26. See [`05-what-shipped.md`](05-what-shipped.md).

Expanded preview alerts queried live-scope history, so the detail was empty or wrong.

### 17. `EVERR_PREVIEW_ALERTS=off` has no effect

**Resolved** by ticket 27. See [`05-what-shipped.md`](05-what-shipped.md).

The preview kill switch was parsed and never read, so `off` changed nothing.

### 18. Generated runbook and alert links do not reach notifications

**Part done**, ticket 28: both links are generated into annotations and frozen into `context_json`, but neither reaches a notification.

Files:

- `packages/app/src/data/alerting/rules/resource/mapping.ts:62`
- `packages/app/src/server/alerting/evaluation/rule.ts:319`
- `packages/app/src/server/alerting/delivery/flush-group.ts:29`

Apply generates alert and runbook link annotations, and channel senders support
a notification URL, but event creation and notification formatting never
populate it.

Required outcome:

- Define link selection when both the alert detail and runbook are available.
- Carry the selected URL from the definition through the event and delivery.
- Add event-to-channel coverage.

### 19. Recipient fan-out and webhook error bodies are unbounded

**Part done**, ticket 29: message bodies are bounded and error text is sanitized; recipient count, send concurrency and the retained error body are not.

Files:

- `packages/app/src/data/alerting/schema.ts:115`
- `packages/app/src/data/alerting/delivery/channel-sender.server.ts:86`
- `packages/app/src/data/alerting/delivery/providers/slack.ts`

Telegram channels accept unbounded recipient arrays and start every
send concurrently. Failed webhooks buffer the complete response body before
building an error.

Required outcome:

- Limit recipient count and field length.
- Use bounded send concurrency and tenant delivery quotas.
- Read and retain only a small bounded error response.

### 20. Silence authorship is client-controlled

**Resolved** by ticket 16. See [`05-what-shipped.md`](05-what-shipped.md).

The silence author came from the client, so the suppression trail could be spoofed.

### 21. Permanently failed event jobs evade retention

**Part done**, ticket 30: retention already separates an active retry from a terminal one; the terminal processing-failure state is still missing.

Files:

- `packages/app/src/server/alerting/maintenance/cleanup.ts:95`
- `packages/app/src/server/alerting/delivery/process-event.ts:114`

Cleanup only selects events with `processed_at < cutoff`. A processing job that
exhausts every retry leaves `processed_at` null, so its event and evidence can
remain indefinitely.

The delivery half of this leak (abandoned deliveries that never reach
terminal status) is covered by the sweep in issue 10 of
[`03-alerting-surface-plan.md`](03-alerting-surface-plan.md), ticket 07.
The event half below is ticket 30.

Required outcome:

- Record a terminal processing failure state and timestamp.
- Retain active retries, but delete terminal failures after a safe horizon.

## Accepted constraints and non-findings

### Breaking Postgres migration

`packages/app/drizzle/0011_robust_cardiac.sql` intentionally drops the earlier
alerting tables. This was not classified as a defect because breaking changes
and loss of earlier alert configuration are accepted for this release stage.

### ClickHouse alert history

The branch now keeps evaluation evidence and transition history in
`app.alert_events`. PostgreSQL retains current state, delivery coordination,
and short-lived evaluation idempotency markers. This supersedes the earlier
review note that accepted retiring ClickHouse alert history.

## Validation status at review time

- The worktree was clean.
- `git diff --check origin/main...HEAD` passed.
- The production build and app typecheck passed.
- The focused test suite passed 63 tests.
- The full app suite previously passed 1,498 tests.

These checks do not cover the concurrency, authorization, failure recovery, and
capacity scenarios listed above.
