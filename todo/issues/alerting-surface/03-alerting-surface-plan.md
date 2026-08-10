# Alerting ClickHouse surface: issue breakdown

This file breaks the Order of work in
[`02-alerting-clickhouse-surface.md`](02-alerting-clickhouse-surface.md)
into small issues. Each issue is one reviewable unit. The doc stays the
design authority; when an issue and the doc disagree, fix the doc first.

The executable tickets live in [`tickets/`](tickets/), one file per
ticket with its blockers, in dependency order. Tickets absorb some
issues and review findings into single vertical slices; each ticket
names its sources. Work any ticket whose blockers are all done.

Phase 1 contains the one-way doors and the front door. Phase 2 is additive:
no issue in it needs a migration or a table recreation. Until phase 2 lands,
the surface is best-effort instead of durable, and an absent row means
unknown.

## Merge gate (decided 2026-08-09)

The branch merges to main when these tickets are done: 01, 02, 03, 04, 05
(phase 1), 12 (pending end to end), 13 (pause and delete end to end), 20
(transactional applies), 21 (org deletion), and 22 (rewritten as the
matcher regex removal). Everything else lands on main afterwards.

Two review P1s are deliberately deferred out of the gate, each with its
risk stated in its ticket: 18 (alerting authorization) waits for a real
RBAC model, and 19 (SSRF-safe webhook delivery) is a non-blocking
follow-up.

Issues 2, 3 and 4 merge as one commit, because the row builders must match
the new DDL when it lands. They are separate issues so each part gets its
own review.

## Phase 1: now

### 1. Name the terminal event type

Doc step 1; blocker 5. The terminal rows that close an instance have no
`event_type` name, and the name is load-bearing: the state view fold keys on
it, and the history UI must not render "resolved" for "someone deleted the
rule".

Constraints on the choice:

- Not `instance_resolved`: `alertingEventStatus` in
  `data/alerting/history/event-types.ts` would render the wrong story.
- A new type changes the "seven of the nine event types" arithmetic in the
  doc.
- Decided 2026-08-09: `instance_closed`, discriminated by the existing
  `reason` column. `instance_resolved` stays the notifying resolve with
  `reason = 'condition_cleared'`.

Required outcome: the name appears in the doc's event-type table and
Reference, the arithmetic is corrected, and
`data/alerting/history/event-types.ts` gains the constant.

### 2. UUIDv7 ids on the ClickHouse path

Doc step 1. Node has no v7 generator, and the builders emit v4 today, so
`UUIDv7ToDateTime(event_id)` would decode random bytes into a nonsense time.

Files:

- `packages/app/src/server/alerts/history/clickhouse.ts`

Required outcome: a small v7 helper with a unit test; every non-delivery
row builder mints v7; delivery rows instead take deterministic ids derived
from the journal event and the delivery key, decided here so id semantics
never flip mid-history (see the `event_id` row in the doc's Reference);
the table's `event_id` default becomes `generateUUIDv7()` (rides issue 3).
The PostgreSQL side is issue 5.

### 3. The recreation DDL

Doc step 1, the immutable core. Lands once; `ORDER BY` and `PARTITION BY`
cannot change after production history exists.

Files:

- `clickhouse/init/12-create-alert-events.sql`
- A migration for existing deployments, every statement with its own
  `SETTINGS`.

Required outcome:

- `PARTITION BY (toYYYYMM(event_time), event_type IN
  ('evaluation_succeeded', 'evaluation_failed'))`, per blocker 1. The
  `event_date` column is dropped. The `set(32)` index is not created.
- Column changes per The table recreation and the recreation findings:
  `instance_labels Map(LowCardinality(String), String)`, `is_live` through
  `DEFAULT`, `service_name`, `write_source`, `reason`,
  `delivery_dedup_key`, `silence_comment`, `silence_matchers_json`,
  `rule_muted` (renamed from `suppressed`), `severity` as
  `LowCardinality(String)`, `row_count UInt64`, `tenant_id` as
  `LowCardinality(String)`, `silence_id UUID`, `evidence_truncated` and
  `samples_truncated` as columns, reserved inhibition-source columns.
- Codecs: `Delta` plus `ZSTD` on the `DateTime64` columns, higher `ZSTD` on
  `evidence_json` and `samples_json`.
- The split TTL: evaluation rows at 30 days, the rest at tenant
  `logs_days`.
- The legacy `app.alert_events_logs_mv` is dropped: alert history is read
  from the typed table, not from `app.logs`.

### 4. Row builders for the new shape

Doc step 1, the write-time half of issue 3. The columns are useless until
the builders fill them.

Files:

- `packages/app/src/server/alerts/history/clickhouse.ts`
- `packages/app/src/server/alerts/evaluation/rule.ts`
- `packages/app/src/server/alerts/delivery/send-delivery.ts`

Required outcome: `service_name` resolved at write time (instance labels
matching `/^service([_-]?name)?$/i`, then `'alert'`);
`write_source = 'live'` on every live insert; `rule_muted`
computed from `spec.suppressed` or preview membership;
`evaluation_scheduled_at` zero off evaluation rows; the `error` column
sanitized at the write boundary so webhook URLs and tokens never land in
it.

### 5. Migration 0011 riders

Doc step 2, schema only. Must land while `drizzle/0011_robust_cardiac.sql`
is unshipped; afterwards each change becomes its own migration and old v4
ids break the derived-time-bound query pattern.

Files:

- `packages/app/src/db/schema/alerts.ts`
- `drizzle/0011_robust_cardiac.sql`
- `drizzle/meta/0011_snapshot.json`

Required outcome: the `kind` discriminator on `alert_events`; the
`alert_event_type` enum extended with `instance_pending`, the terminal
type, the hold decision type, and `evaluation_failed` as a journaled state
kind (per the Durability table); the id default as a `uuidv7()`
expression, not `defaultRandom()`; a PostgreSQL-stamped timestamp column
(`journaled_at`, transaction-start time) on the journal tables, so the
future reconciler diff never filters on a Node clock. Follow Changing the schema in the doc: no
`drizzle-kit generate`.

### 6. Tenancy: let `cloud query` reach the table

Doc step 3; blocker 2. Today `sql_api_role` has no grant on
`app.alert_events`, so the surface's one intended caller gets a permission
error.

Files:

- `clickhouse/init/15-create-sql-api-role.sql`
- `clickhouse/init/20-apply-rls.sql`
- The per-organization provisioning code path.

Required outcome: grant, default-deny policy, per-organization row policy,
and provisioning for `app.alert_events`, copyable as the template for every
future alerting object. A check that no materialized view leaks across
tenants.

### 7. The skill file

Doc step 3. Two foundational arguments rest on it ("schema size is a
budget", "documentable in a page") and nothing produces it.

Required outcome: an agent-facing skill file with the column reference and
worked queries, generated from or checked against the doc's Reference
section, with a stated rule for keeping them in lockstep. If the Reference
plus its caveats does not fit the page budget, that is a design signal to
report, not to paper over.

### 8. Reference hygiene riders

Doc, no code. Applied on 2026-08-09: the entry worked queries return
`notification_event_id`, every worked query carries a `LIMIT`, the
worked-query findings are folded in (single-scan undelivered form,
aggregate-then-join template, `GROUP BY repoid, slug`, retired tie-break
claim), and the no-personal-data claim is conditioned on the open
labels-redaction question. What remains is verification against a live
stack, which rides issue 7's skill file.

## Phase 2: later, additive

### 9. Reconciliation: the transitions diff

Doc step 4; blockers 3 and 4. One Graphile job in a named queue, diffing
journal ids against ClickHouse ids for a window.

Required outcome:

- Idempotent repair inserts: `insert_deduplication_token` derived from
  stream plus id, `non_replicated_deduplication_window` set on the table,
  synchronous insert mode pinned and documented. The live insert path
  shares the same token scheme and insert mode, so an in-doubt live write
  converges with its reconciled copy instead of duplicating.
- The evaluation-failure stream is journaled on the write path and diffed
  like the transitions; success rows stay fire and forget.
- The window filters on `journaled_at` from issue 5, evaluated on the
  PostgreSQL clock; it is transaction-start time, so the window carries a
  visibility margin.
- Both window bounds as tested invariants: wider than any plausible outage
  plus the delivery retry span plus the longest journal-writing
  transaction, narrower than min(tenant `logs_days`, the
  90-day journal retention in
  `server/alerts/maintenance/cleanup.ts`).
- Reconciled rows carry `write_source = 'reconciled'` and the journal
  timestamp as `event_time`.

### 10. Reconciliation: the deliveries diff

Doc step 4; blocker 6. Presence-based diffing cannot detect a lost
success, and the documented diff key does not exist on the ClickHouse
side.

Required outcome: delivery rows get deterministic ids derived from the
journal; the diff compares outcomes, repairing a `delivery_succeeded` row
whenever PostgreSQL status is `sent` and no succeeded row exists for the
pair; a sweep moves deliveries abandoned past the retry horizon to a
terminal `failed` so they become diffable and collectable. The "Excluded
from ClickHouse" row on dedup keys is narrowed.

### 11. Counters

Doc step 5. Required outcome: a counter or span event on
`alerts.history.insert_failed` and
`alerts.history.delivery_outcome_failed`, and a repair counter per stream
in the reconciler. A rising repair rate means the primary path rots;
repairs for rows never dropped mean the window is wrong.

### 12. Hold decision rows

Doc step 2's code half, first part. Hold decisions stop mutating the work
item; each change to the `(silenced, inhibited, silence_id)` triple
journals a decision row referencing the event.

Files:

- `packages/app/src/server/alerts/delivery/suppression.ts`
- `packages/app/src/server/alerts/delivery/process-event.ts`

Required outcome: the compare-and-insert runs in one transaction holding
the event row lock, and the previous triple is read from the journal,
never from ClickHouse. The freeze-then-clear sequence disappears. One row
per hold period, not per 60-second re-deferral.

### 13. `notification_deferred` with the freezes

Doc step 6. Needs issues 3 and 12.

Files:

- `packages/app/src/server/alerts/delivery/suppression.ts`

Required outcome: the new event type projects from the decision rows; the
silence comment and matchers freeze onto it and onto
`notification_suppressed`; the inhibiting source freezes into the columns
issue 3 reserved. A deferred chain that ends without delivery gets its own
terminal `notification_suppressed` row with a matching `reason`, so "what
is held right now" can close.

### 14. Born-processed events and the structural skip

Doc step 2's code half, second part. Pending, pending-cleared and the
lifecycle terminals exist only to be projected.

Required outcome: the delivery pipeline reads work through one function
that hard-codes `kind = 'notifying'`, and nothing else queries the journal
for deliverable events. Deleting a rule pages nobody, as a property of the
module boundary, not a convention.

### 15. `instance_pending` and its terminal

Doc step 7, first half. Also closes finding 11 in
[`04-alerting-branch-review.md`](04-alerting-branch-review.md) (pending rules
reported as OK).

Required outcome: `instance_pending` rows on entry to pending; a terminal
row with `reason = 'pending_cleared'` when the condition clears before
firing; both journaled, born processed.

### 16. Terminals on pause and delete

Doc step 7, second half. Pause and delete journal one terminal event per
open instance, with the reason, in the mutation's own transaction. Pause
also resets its instances to `inactive` so resume starts from scratch.
Preview deletion writes its terminals as projections only, ephemeral by
declaration.

### 17. `app.alert_state`

Doc step 8. Needs issues 15 and 16. Closes scope priority 1. The decision
list lives in the doc, including: the fold ties break on
`(event_time, event_id)`; the view folds `is_live` rows across both write
sources; the retention-horizon question (a transition row that TTL-expires
while its instance stays open) is answered before the view ships; the
refreshable-materialized-view escalation carries the tenancy template as a
precondition. Add the worked query to the Reference and the skill file
when it lands.

### 18. Engine spans

Doc step 9. Independent; can run beside anything. The decision list lives
in the doc: which operations, `everr.feature` attribute naming mirrored
from `routes/api/cli/sql.ts`, `classifyCloudQueryError` so rule syntax
errors do not page, trace propagation through Graphile.

### 19. Actor plumbing

Doc step 10, first half; the largest code change and none of it in
ClickHouse. No mutation site records an actor today, and the actor is
dropped where `alertingOrganizationId(session)` narrows the session.

Required outcome: an actor argument threaded through that boundary,
sourced from `ApplyAuth.principalId` (`user:<id>` or `apikey:<id>`); it
replaces the client-controlled `alert_silences.author` rather than sit
beside it.

### 20. The audit journal

Doc step 10, second half. Needs issue 19. PostgreSQL only: one audit row
per qualifying mutation, committed at the mutation boundary, read by the
application, with an enforcement boundary no mutation path can skip. The
open decisions (which mutations qualify, actor column shape, snapshot
versus diff, channel config redaction) live in the doc.
