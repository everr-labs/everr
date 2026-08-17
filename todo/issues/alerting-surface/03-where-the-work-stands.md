# 03: Where the alerting work stands

The design authority is
[`02-alerting-clickhouse-surface.md`](02-alerting-clickhouse-surface.md).
When this file and the doc disagree, fix the doc first.

This file is both tenses of the same question. What is left comes first,
because it is what anyone picking the work up needs. What shipped follows
as reference: it replaced the 19 tickets for completed work, deleted on
2026-08-16, and keeps their numbers in its headings so a number in git
history, in a code comment, or in PR #343 still resolves to something.

The executable tickets for what is left live in [`tickets/`](tickets/),
one file per ticket with its blockers and its own detail. Work any ticket
whose blockers are all done. Ticket numbers are stable: they are cited by
code comments and by PR #343, so a number is never reused or renumbered,
and the sequence has gaps where completed tickets were removed.

## The merge gate is met

The gate decided on 2026-08-09 was tickets 01, 02, 03, 04, 05, 11, 12,
13, 20, 21 and 22. All of them are below, and ticket 16 landed with them
because the actor it plumbs is what a silence stores.

Two P1s are deliberately outside the gate and still open, each with its
risk stated in its ticket: 18 (alerting authorization, waits for a real
RBAC model) and 19 (SSRF-safe webhook delivery). Merging ships both risks
knowingly.

Two things to carry into a deploy.

`drizzle/0011_robust_cardiac.sql` drops the earlier alerting tables on
purpose. Breaking changes and the loss of earlier alert configuration are
accepted at this release stage.

The delivery worker needs restricted egress. That is ticket 19's decision
of 2026-08-16: the remaining SSRF exposure is a DNS rebinding window
between the guard's lookup and the send's own, and it is closed in the
network rather than with a pinned-address dialer in the application. A
release that skips it ships the window open. The ticket carries the
evidence, the ranges to deny, and what would reopen the application fix.

## What is left

Phase 1 was the one-way doors and the front door: the final table shape,
the row builders, the migration riders, tenancy and the skill file. It is
done. Phase 2 is additive. No ticket in it needs a migration or a table
recreation. Until it lands, the surface is best effort rather than
durable, and an absent row means unknown.

The 24 open tickets group into six arcs. The first three are the ones
that finish the design; the last three are hardening and the batch the
integration suite turned up.

### Arc A: durability (06, 07, 08)

The reconciler that makes a dropped insert a delay instead of a permanent
hole, the delivery diff and sweep beside it, and the counters that say
whether the primary path is rotting. The table's
`non_replicated_deduplication_window` is already sized for this arc, and
the live insert path already carries its deduplication token, so the
schema is committed to a reconciler that does not exist yet.

### Arc B: the vocabulary gets its writers (09, 10, 14)

`hold_changed` sits in the event-type enum and in a CHECK constraint with
nothing writing it, and `notification_deferred` appears nowhere in the
source. This arc gives them writers, with the silence and inhibition
freezes, and adds `app.alert_state`. Until it lands, the schema promises
rows that do not exist.

### Arc C: attribution and observability (15, 17, 31)

The engine has no spans and no counters, so no operational question about
it has an answer. Ticket 16 already put the actor where the audit journal
needs it, so 17 is unblocked, and 31 extends it to the remaining
mutations.

### Arc D: delivery hardening (23, 28, 29, 30)

Per-recipient delivery state, the alert and runbook links reaching a
notification, bounded recipients and error bodies, and the terminal
failure state that retention needs. Each ticket records which half is
already in place.

### Arc E: settled by decision (18, 19)

Authorization waits for a real RBAC model, and ships as an accepted risk.

Ticket 19 is no longer application work. The guard in
`providers/outbound.ts` already refuses internal literals, resolves a name
with `all: true` and rejects it if any address is blocked, forbids
userinfo and non-http schemes, and refuses redirects; Telegram takes no
user host at all. What is left is the rebinding window between that lookup
and the send's own, and on 2026-08-16 it was decided to close that in the
network: restricted egress on the delivery worker, and the same
requirement documented for self-hosted operators. The reference
implementation was checked before deciding, and it is weaker than ours:
Grafana's own webhook sender does no URL validation whatsoever. The ticket
carries that evidence and the conditions that would reopen the pinned
dialer, the sharpest being a hosted multi-tenant product, where the
precedent is Grafana OnCall's CVE-2024-5526 rather than Grafana core.

### Arc F: found by the integration suite (34, 35, 37, 38, 39, 40, 43, 44, 46)

Nine tickets filed while building and testing the pipeline and still open
in the engine. Ticket 39 already has a characterization case that pins
today's answer, so whoever lands the fix flips the expectation rather
than writing the case. 46 came out of the read of the flush claim. The
three smallest of the arc (41, 42 and 47) shipped before the release and
are below.

## What shipped

Organised by theme rather than by ticket. The ticket numbers in each
heading are the ones that built it.

### The journal reaches its final shape (01, 03)

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

### The history table and its writers (02)

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

### Reading the history (04, 05)

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

### State rows can never be delivered (11)

`delivery/journal-reader.ts` is the delivery pipeline's only way to read
the journal, and both of its reads hard-code `kind = 'notifying'`, pinned
by tests that render the real SQL. A second fence sits upstream: the
evaluator never enqueues process jobs for state rows
(`shouldEnqueueProcessEvent`, tested against real `transitionEventRows`
output).

### The instance lifecycle is complete (12, 13)

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

### Every mutation knows who did it (16)

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

### Applies and cleanup (20, 21)

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

### Matchers are exact match only (22)

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

### Preview scope (26, 27)

Preview identity threads through the history query as `previewIds` on
`queryClickHouseAlertEventLog`: `null` means live only, an empty list
means the same, and a populated list overlays those previews on live
history. `EVERR_PREVIEW_ALERTS=off` now gates the scanner through an
extracted pure predicate, so preview-owned definitions are excluded from
selection and never enqueued, tested for both values.

### Charts and lists (24, 25)

Downsampling builds a required set first (range edges, every failed or
breaching evaluation, every state transition including recovery) and
fills the remaining display budget with the even grid, so a required
point is never dropped even when the required set exceeds the budget.
Rule polling no longer disables itself past the first page: the
`refetchInterval` conditional is gone, and a background refetch of an
infinite query walks every loaded page.

### Fixes found in review and testing (32, 33, 45)

- **32**: notification history stopped making a channel undeletable. A
  settled delivery keeps the channel name it was sent to, so only a
  delivery that still has a send to make holds the channel open.
- **33**: the `for` clock survives an outage. A stretch that nothing
  watched restarts the clock, because `for` promises the condition held
  continuously.
- **45**: a channel that will never accept the message stops trying. A
  permanent failure fails on the first attempt for every channel type,
  not just two of the four.

### The pipeline runs against real databases in the suite (no ticket)

Landed as PR #360. The harness lives in `server/alerting/testing/`: PGlite
holds PostgreSQL in the vitest process with both migration sets applied,
chdb holds ClickHouse with the shipped `app.alert_events` DDL, a job
driver dispatches `graphile_worker` rows to the real handlers in
`alertTaskList`, and one virtual clock drives JavaScript and PostgreSQL
together. Every constraint, CHECK, enum, foreign key, unique index,
`FOR UPDATE` and upsert runs as written. Only outbound HTTP is a double.

Eleven files cover the pipeline: smoke, lifecycle, suppression, delivery,
capacity, routing, invariants, history, preview, retention and the read
path. Each capacity case sits on a documented bound. Two organizations
run the same rule slugs and receiver names to prove tenant isolation.
The suite is what found tickets 34 to 47.

What it cannot do is stated rather than papered over: PGlite is one
connection, so true concurrency and `FOR UPDATE SKIP LOCKED` stay
unproven, and tests drive the serialized outcome of a race instead. The
harness sees the databases and the captured requests, so it cannot
observe telemetry (which is why ticket 35 stays open past the capacity
case that reaches its bound).

### The stage tests stopped standing in for the database (36)

The suite's own follow-up, and the last thing the deleted pipeline test
plan still owed. Sixteen alerting test files substituted the database
with fluent fakes. Six were only import guards around pure functions.
The other ten were read case by case against the integration suite, and
the outcome was recorded per file before anything was deleted: two files
went whole (`delivery/targeting`, `silences/repository`), one lost the
`fullTx` helper that reimplemented `INSERT ... ON CONFLICT DO UPDATE` in
JavaScript, and 79 cases became 60.

Nine integration cases were written first, so nothing was deleted without
a home: the hold tick, a reorder-only label change, a repeated
`scheduledFor`, the pause health reset and the pause projection; the dead
group member with and without a delivery behind it, and the channel-less
receiver; one delivery fanned over several transitions; a second cancel
of one silence.

What stays faked is what the harness cannot produce: a write that throws
mid-transaction, a claim lost to a concurrent cancel, a group-creation
race, a query that rejects. A fake that answers a query the suite can
drive for real is what this removed. Full app suite after it: 206 files,
1650 tests, green.

### The three smallest findings of Arc F, before the release (41, 42, 47)

Picked out of the arc on 2026-08-17 on one test: small enough to land and
verify in a sitting, with no decision left to take first. The other nine
tickets of the arc each need a decision, a migration-free but multi-file
change, or both, and none of them is a release gate.

- **41**: a group parked on the idle sentinel wakes again. `nextGroupFlushAt`
  read "no `last_flushed_at`" as "a first flush is already booked" and could
  not tell that apart from the year-9999 park, so every later dispatch wrote
  the sentinel back and the group never notified again. A parked group now
  takes a group wait, the same answer a group nobody has seen gets, and a
  booked first flush is still not postponed. The characterization case in
  `pipeline-delivery.integration.test.ts` flipped to the wanted answer and
  now also proves the group flushes when it comes due.
- **42**: an evaluation error is sanitized on every path.
  `recordEvaluationFailure` built one message for two stores and sanitized
  only the ClickHouse copy, so `alert_definitions.last_error`, which the rule
  detail page renders, kept the raw text. It now sanitizes once at the top,
  the same boundary `failDelivery` settled. The rule is stated where the next
  writer will see it, on `sanitizeAlertError` itself, with the difference
  that matters: ClickHouse is append-only and `last_error` is overwritten, so
  this buys one rule to copy, not permanence.
- **47**: routing stopped asking twice for the receiver it had. `loadRoutes`
  joined `alert_receivers` and kept only the name, and the dispatch loop
  re-selected the row per matched route to read back the id the join already
  held. The join now carries the id, `alertingSelectRoutes` is generic over
  the loaded route so the extra field survives selection, and the
  `!receiver` guard is gone rather than bypassed: the composite foreign key
  and the unique index on `(organization_id, name)` made it unreachable. One
  round trip per matched route per event leaves the dispatch path.

450 alerting tests green, `tsc --noEmit` and `biome check` clean.
