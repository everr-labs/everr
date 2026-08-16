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

Files:

- `packages/app/src/data/alerting/rules/repository.ts:519`
- `packages/app/src/server/alerting/delivery/suppression.ts:50`
- `packages/app/src/server/alerting/delivery/flush-group.ts:99`

Pausing changes the definition flag but leaves firing instances, pending group
flushes, and repeat notifications active. Existing notification groups can
continue sending after an operator pauses the rule.

Issue 16 in [`03-alerting-surface-plan.md`](03-alerting-surface-plan.md)
closes the history side of pause (terminal rows and the instance reset).
This finding is the delivery side; both land together as ticket 13. The
pending-notification decision is made (2026-08-09): cancel everything;
see the design doc and ticket 13.

Required outcome:

- Make delivery checks account for the active or paused state of the rule.
- Stop repeat delivery for paused rules.
- Define and test whether pending notifications are canceled or retained when
  the rule is paused.

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

Files:

- `packages/app/src/data/as-code/registry.ts:221`
- `packages/app/src/data/alerting/rules/resource/apply.server.ts:184`

The alert reconciler ignores the transaction executor supplied by the
resource registry. If a later reconciler fails, apply reports failure even
though earlier alerting mutations already committed.

Required outcome:

- Pass the supplied executor through every alert repository mutation,
  or explicitly replace the transaction contract with a durable convergence
  protocol.
- Add an integration test where a later resource kind fails after alerting
  mutations begin.

### 9. Organization deletion fails when a rule uses a direct channel

**Resolved** by ticket 21. See [`05-what-shipped.md`](05-what-shipped.md). One integration case stays open on that ticket.

Files:

- `packages/app/src/lib/organization-data-cleanup.server.ts:43`
- `packages/app/src/db/schema/alerts.ts:349`

Cleanup deletes channels before definitions, while the direct rule-to-channel
foreign key does not cascade when a channel is deleted. PostgreSQL rejects the
delete and rolls back the organization cleanup.

Required outcome:

- Delete direct channel mappings first, or delete alert definitions before
  channels.
- Add an organization cleanup integration test with direct rule channels.

### 10. Routing regexes permit CPU and memory denial of service

**Retired by construction** in ticket 22: the regex ops are removed, so no user pattern reaches `RegExp`. See [`05-what-shipped.md`](05-what-shipped.md).

Files:

- `packages/app/src/data/alerting/routing/resolution.ts:24`
- `packages/app/src/data/alerting/schema.ts:34`

User-provided patterns run through native JavaScript `RegExp`, which permits
catastrophic backtracking. The process-wide regex cache is unbounded despite
its comment saying that configuration bounds it.

Resolved by decision on 2026-08-09: regex matching is removed instead of
hardened. Matchers become exact match only; ticket 22 carries the removal,
and safe pattern matching is a follow-up idea in
`../../ideas/alerting-matcher-patterns.md`.

Original required outcome, superseded by the removal:

- Use a linear-time regex engine such as RE2.
- Limit matcher counts, pattern lengths, and matched value lengths.
- Replace the global map with a bounded cache.

### 11. Pending rules are reported as OK

**Resolved** by ticket 12. See [`05-what-shipped.md`](05-what-shipped.md).

Files:

- `packages/app/src/server/alerting/evaluation/rule.ts:288`
- `packages/app/src/data/alerting/rules/repository.ts:60`
- `packages/app/src/routes/_authenticated/_dashboard/_previewable/alerts/rules_.$project.$slug.tsx:63`

Definition state stores only firing or resolved. The repository maps everything
except firing to inactive, so the detail page's Pending state is unreachable
even when instances are breaching during `for_secs`.

This is the UI side of the `instance_pending` gap. Build it with issue 15 in
[`03-alerting-surface-plan.md`](03-alerting-surface-plan.md); both land
together as ticket 12.

Required outcome:

- Derive or persist a pending definition state.
- Keep rule lists, detail pages, triage, and API vocabulary consistent.
- Cover inactive, pending, firing, and resolved rollups.

## P2: important follow-ups

### 12. Delivery retries can send duplicate notifications

**Part done**, ticket 23: one send twice leaves one `delivery_succeeded` row, but a fan-out has no per-recipient state, so a retry re-sends to recipients that already succeeded.

Files:

- `packages/app/src/server/alerting/delivery/send-delivery.ts:24`
- `packages/app/src/data/alerting/delivery/channel-sender.server.ts:133`

A provider can accept a request before the worker fails to mark the delivery as
sent. The retry sends it again. Email and Telegram fan-out can also partially
succeed, after which `Promise.all` rejects and retries every recipient.

Required outcome:

- Use provider idempotency where available.
- Track recipient-level fan-out state when one logical delivery targets several
  recipients.
- Document the remaining at-least-once behavior.

### 13. Evaluation downsampling can hide exceptional evaluations

**Resolved** by ticket 24. See [`05-what-shipped.md`](05-what-shipped.md).

File: `packages/app/src/data/alerting/rules/evaluation-series.ts:37`

Even index selection preserves range edges but does not preserve failed,
breaching, or state-transition evaluations. A chart can omit the only important
point in the selected range.

Required outcome:

- Preserve exceptional points and state transitions before filling the
  remaining display budget with representative samples.
- Add a test with one exceptional point between sampled indexes.

### 15. Rule polling stops after the second page is loaded

**Resolved** by ticket 25. See [`05-what-shipped.md`](05-what-shipped.md).

File: `packages/app/src/data/alerting/rules/queries.ts:35`

The infinite query disables polling when it contains more than one page.
Organizations with more than 100 rules stop receiving live list updates.

Required outcome:

- Refresh paginated rule data without silently disabling updates.
- Cover an organization with at least two pages.

### 16. Expanded preview alerts request live history

**Resolved** by ticket 26. See [`05-what-shipped.md`](05-what-shipped.md).

File: `packages/app/src/routes/_authenticated/_dashboard/_previewable/alerts/-components/triage/instance-detail.tsx:28`

The expanded triage detail does not pass preview identity to its history query.
Preview alerts can show empty or misleading evidence and transitions.

Required outcome:

- Carry preview identity through the history query.
- Test the same rule identity in live and preview scopes.

### 17. `EVERR_PREVIEW_ALERTS=off` has no effect

**Resolved** by ticket 27. See [`05-what-shipped.md`](05-what-shipped.md).

Files:

- `packages/app/src/env/index.ts:27`
- `packages/app/src/server/alerting/scheduling/scanner.ts:23`

The environment variable is parsed but never used by scheduling or evaluation.
The documented operational kill switch cannot reduce preview evaluation load.

Required outcome:

- Enforce the switch before preview work is enqueued.
- Test both values.

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

Email and Telegram channels accept unbounded recipient arrays and start every
send concurrently. Failed webhooks buffer the complete response body before
building an error.

Required outcome:

- Limit recipient count and field length.
- Use bounded send concurrency and tenant delivery quotas.
- Read and retain only a small bounded error response.

### 20. Silence authorship is client-controlled

**Resolved** by ticket 16. See [`05-what-shipped.md`](05-what-shipped.md).

Files:

- `packages/app/src/data/alerting/schema.ts:184`
- `packages/app/src/data/alerting/silences/server.ts:13`
- `packages/app/src/data/alerting/silences/repository.ts:40`

The caller can submit any author string, so the alert-suppression audit trail is
spoofable.

Absorbed by issue 19 in
[`03-alerting-surface-plan.md`](03-alerting-surface-plan.md): the actor
plumbing must replace this column, not sit beside it. Tracked there, as
ticket 16.

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
