# 05: What shipped on the alerting surface

This file replaces the 19 tickets for completed work, deleted on
2026-08-16. Their numbers stay in the headings below, so a ticket number
in git history, in a code comment, or in PR #343 still resolves to
something.

What is still open keeps its own ticket in `tickets/`, indexed by
`03-alerting-surface-plan.md`.

## The merge gate is met

The gate decided on 2026-08-09 was tickets 01, 02, 03, 04, 05, 11, 12,
13, 20, 21 and 22. All of them are below. Ticket 16 landed with them,
because the actor it plumbs is what a silence stores.

Two P1s are deliberately outside the gate and still open, each with its
risk stated in its ticket: 18 (alerting authorization, waits for a real
RBAC model) and 19 (SSRF-safe webhook delivery). Merging ships both risks
knowingly.

One more thing to carry into a deploy: `drizzle/0011_robust_cardiac.sql`
drops the earlier alerting tables on purpose. Breaking changes and the
loss of earlier alert configuration are accepted at this release
stage.

## The journal reaches its final shape (01, 03)

The PostgreSQL journal took its final shape while migration 0011 was
still unshipped, so the whole branch carries one migration rather than a
chain of riders.

- `alert_event_kind` (`notifying` | `state`) discriminates rows that a
  delivery may act on from rows that only record what happened. State
  rows are born processed.
- `instance_closed` is the one non-notifying terminal, discriminated by
  the existing `reason` column (`pending_cleared`, `rule_paused`,
  `rule_deleted`, `preview_deleted`). `instance_resolved` stays the
  notifying resolve, with `reason = 'condition_cleared'`. A closure can
  never render as a recovery.
- The event-type enum also gained `instance_pending`, `hold_changed` and
  `evaluation_failed`.
- `alert_events.id` defaults to native `uuidv7()`. Only the journal id
  qualifies; configuration and state ids stay v4.
- `journaled_at timestamptz NOT NULL DEFAULT now()` on `alert_events` and
  `alert_deliveries` is the commit-side clock ticket 06's diff will
  filter on. `occurred_at` stays domain time.
- Nullable `episode_id` on `alert_events` and `alert_instances`.

Mechanics, per the design doc's "Changing the schema": no
`drizzle-kit generate`. 0011 and `meta/0011_snapshot.json` were edited by
hand, with the snapshot round-trip verified byte-identical before
patching, and the dev database altered to match with enum value order
pinned.

## The history table and its writers (02)

The one-way door. `app.alert_events` was recreated in its final shape,
and the row builders landed in the same commit because they must match
the DDL.

- `PARTITION BY (toYYYYMM(event_time), event_type IN ('evaluation_succeeded','evaluation_failed'))`.
  `event_date` dropped, no set index, `ORDER BY` unchanged.
- The full column set: `instance_labels Map(LowCardinality(String), String)`,
  `is_live` by `DEFAULT` and never MATERIALIZED, `service_name`,
  `write_source`, `reason`, `delivery_dedup_key`, the silence and reserved
  inhibition freeze columns, `rule_muted`, LowCardinality `severity` and
  `tenant_id`, `row_count`, `silence_id`, the truncated flags,
  `episode_id` and `context_json`.
- `CODEC(Delta, ZSTD(1))` on the DateTime64 columns, `ZSTD(6)` on the
  three JSON columns, and a split TTL: evaluation rows at 30 days, the
  rest at tenant retention.
- The legacy `app.alert_events_logs_mv` is dropped. Nothing consumed
  alert rows in `app.logs`, so history is read from the typed table only.

Writers:

- Every non-delivery row is minted UUIDv7 (RFC 9562, unit-tested by
  decoding the timestamp back). Delivery rows take deterministic v8 ids
  hashed from the journal event, the delivery key and the outcome, with
  failed attempts adding their attempt time, so a repaired success
  converges instead of duplicating.
- Episodes: `instance_fired` opens the episode with its own id and stamps
  it onto `alert_instances`, `instance_resolved` carries and clears it.
  With a for-duration the episode opens at `instance_pending` instead,
  and the fire inherits it.
- `service_name` resolves by label match, then falls back to `'alert'`.
- Labels are capped at the write boundary (256 key, 1024 value, truncate
  rather than drop). Provider error text is sanitized for URLs, webhook
  hosts and bot tokens before the append-only `error` column.
- `context_json` freezes `{summary, description, links: {runbook, alert},
  condition}` on lifecycle rows, empties omitted.

Verified on the dev stack at ClickHouse 26.2: rows land in the new shape,
`UUIDv7ToDateTime(event_id)` equals `event_time`, the chain query with
its derived bound returns the fire and every delivery attempt, the
partitions split and `EXPLAIN indexes=1` prunes both dimensions from a
plain `event_time` bound, and an `instance_fired` row carries an
`episode_id` equal to its own `event_id` with the same id on the
PostgreSQL instance row.

## Reading the history (04, 05)

Tenancy is the template every future alerting object copies:
`GRANT SELECT ON app.alert_events TO sql_api_role`, a
`sql_api_default_deny_alert_events` row policy, and per-organization
policies created by `provisionSqlApiOrgUser` looping over
`SQL_API_TENANT_TABLES`. That constant lives in `lib/sql-api-tables.ts`,
so the schema-probe error message and the MCP tool description derive the
readable-table list instead of hand-syncing copies.
`clickhouse/migrate-alert-events-sql-api-access.sql` ends with a
generator that prints the per-organization backfill from `system.users`,
because pre-existing organizations would otherwise read zero rows
silently.

The caller-facing artifact is
`crates/everr-core/assets/skills/everr-use-telemetry/rules/alert-history.md`,
in lockstep with the design doc's Reference: six query rules, the
event-type table, the 28-column reference and seven worked queries.

The permission transcript was verified on dev. Before the grant the
caller got the uniform schema-probe error. After the grant but before the
per-organization policy, `count()` returned 0, which is default deny
proving itself. After the backfill, own rows were visible and another
tenant's were not. All seven documented queries ran verbatim under the
SQL API profile.

Design signal recorded rather than papered over: the reference does not
fit the "roughly a page" budget. 28 columns drive it to about three.

## State rows can never be delivered (11)

`delivery/journal-reader.ts` is the delivery pipeline's only way to read
the journal, and both of its reads hard-code `kind = 'notifying'`, pinned
by tests that render the real SQL. A second fence sits upstream: the
evaluator never enqueues process jobs for state rows
(`shouldEnqueueProcessEvent`, tested against real `transitionEventRows`
output).

## The instance lifecycle is complete (12, 13)

**Pending.** The state machine emits `instance_pending` on entry to the
for-duration and `instance_closed` with `reason = 'pending_cleared'` when
the condition clears early. The PostgreSQL `alert_state` enum gained
`pending`, `rollupAlertState` passes it through, and the Pending badges
became reachable in list, detail, history, signal chart and triage.

**Pause and delete.** `closeRuleLifecycle` runs inside the mutation's own
transaction: it journals one born-processed `instance_closed` per open
instance with its reason and episode, cancels every unprocessed notifying
event, and enqueues the `alerts/project-lifecycle` job transactionally,
so the ClickHouse projection runs exactly when the mutation commits. That
is also what makes `deleteRule` correct under the registry's apply
transaction.

Pause cancels the whole chain: unprocessed and deferred events in one
guarded update, group members at flush time (the claim left-joins the
definition and drops paused or deleted rules, writing the terminal for
chains that never notified), and the send job itself, where
`send-delivery` re-checks rule liveness and permanently fails the
delivery rather than sending. Resume starts fresh: instances reset to
inactive with episodes cleared, so a still-breaching rule re-pends,
re-fires and re-notifies.

The pause race is closed by construction. Group membership and the
`processed_at` stamp commit in one transaction, with the stamp guarded by
`processed_at IS NULL`, so whichever of dispatch and cancel commits
first, exactly one terminal per chain results. An already-notified chain
is not suppressed retroactively; that is recorded in the design doc.

Preview deletion writes its terminals as projections only:
`deleteStalePreviews` collects the open set inside the delete transaction
and projects `instance_closed` with `reason = 'preview_deleted'` for the
previews it actually removed.

## Every mutation knows who did it (16)

`AlertingActor` (`user` | `apikey` | `system`, with id and display) lives
at the session-narrowing boundary in `data/alerting/session.ts`, and
`alertingMutationScope(session)` derives `{ organizationId, actor }`.
Reads keep the plain organization id, because a read is not
attributable. The apply path publishes `principalId` (`user:<id>` or
`apikey:<id>`) into the session context, so an API-key apply is never
mis-attributed to a user, and a malformed principal throws rather than
guesses.

The silence `author` input field is gone. Zod strips a client-sent
author, and the column is written server-side from the actor's display,
so the suppression trail cannot be spoofed. A client-supplied note keeps
the separate `comment` column.

Recorded as still open when 16 landed: as-code rule mutations are reached
through the resource registry rather than a server function, and
`context.actor` is on the apply context for ticket 17 to thread through.
`testChannel` stays unattributed, because it changes no state.

## Applies and cleanup (20, 21)

The alert reconciler writes through the transaction executor the resource
registry supplies. Rule mutations nest as savepoints and run serially,
because savepoints on one connection must nest strictly, and evaluation
jobs are enqueued through `graphile_worker.add_job` inside the same
transaction. A later reconciler failure rolls the alerting mutations
back, and a rolled-back apply leaves no orphan evaluation job. The
executor parameter is required on the four mutations, so a missed call
site fails to compile instead of silently escaping the transaction.

The ticket's literal scenario, a later resource kind failing after
alerting mutations, is unreachable because alerts reconcile last.
`pipeline-invariants.integration.test.ts` covers the reachable half.

Organization cleanup deletes `alert_definition_channels` before
`alert_channels`, mirroring the receiver-channels treatment, so all three
non-cascading foreign keys into `alert_channels` are cleared first. An
organization-cleanup integration case is still open on ticket 21, and is
writable now that a real-database harness exists.

## Matchers are exact match only (22)

`regex` and `notregex` are gone from the shared matcher op enum, so
route, silence and inhibition matchers are exact match only. The
rejection message names the removal. The regex evaluation path and its
unbounded process-wide cache are deleted, so no user pattern reaches
`RegExp` anywhere in the alerting tree. Bounds: 64 matchers per list,
256-character labels, 1024-character values. Rows persisted with a
retired op never match, enforced exhaustively at compile time, and render
their raw op name rather than "undefined". This retires review finding 10
by construction. A follow-up for safe pattern matching lives in
`todo/ideas/alerting-matcher-patterns.md`.

## Preview scope (26, 27)

Preview identity threads through the history query as `previewIds` on
`queryClickHouseAlertEventLog`: `null` means live only, an empty list
means the same, and a populated list overlays those previews on live
history. `EVERR_PREVIEW_ALERTS=off` now gates the scanner through an
extracted pure predicate, so preview-owned definitions are excluded from
selection and never enqueued, tested for both values.

## Charts and lists (24, 25)

Downsampling builds a required set first (range edges, every failed or
breaching evaluation, every state transition including recovery) and
fills the remaining display budget with the even grid, so a required
point is never dropped even when the required set exceeds the budget.
Rule polling no longer disables itself past the first page: the
`refetchInterval` conditional is gone, and a background refetch of an
infinite query walks every loaded page.

## Fixes found in review and testing (32, 33, 45)

- **32**: notification history stopped making a channel undeletable. A
  settled delivery keeps the channel name it was sent to, so only a
  delivery that still has a send to make holds the channel open.
- **33**: the `for` clock survives an outage. A stretch that nothing
  watched restarts the clock, because `for` promises the condition held
  continuously.
- **45**: a channel that will never accept the message stops trying. A
  permanent failure fails on the first attempt for every channel type,
  not just two of the four.
