# Alerting surface: the plan and what is left

The design authority is
[`02-alerting-clickhouse-surface.md`](02-alerting-clickhouse-surface.md).
When this file and the doc disagree, fix the doc first.

What already shipped is described in
[`05-what-shipped.md`](05-what-shipped.md), not here. The executable
tickets for what is left live in [`tickets/`](tickets/), one file per
ticket with its blockers. Work any ticket whose blockers are all done.

Ticket numbers are stable. They are cited by code comments and by
PR #343, so a number is never reused or renumbered, and the sequence has
gaps where completed tickets were removed on 2026-08-16.

## Merge gate: met

The gate decided on 2026-08-09 was tickets 01, 02, 03, 04, 05, 12, 13,
20, 21 and 22. All are done, with 11 and 16 alongside them. See
[`05-what-shipped.md`](05-what-shipped.md).

Two review P1s were deliberately left outside the gate, each with its
risk stated in its ticket: 18 (alerting authorization) waits for a real
RBAC model, and 19 (SSRF-safe webhook delivery) is a non-blocking
follow-up. Merging ships both risks knowingly.

## Phase 1: shipped

The one-way doors and the front door: the final table shape, the row
builders, the migration riders, tenancy and the skill file. Described in
[`05-what-shipped.md`](05-what-shipped.md).

## What is left

Phase 2 is additive. No ticket in it needs a migration or a table
recreation. Until it lands, the surface is best effort rather than
durable, and an absent row means unknown.

The 28 open tickets group into six arcs. The first three are the ones
that finish the design; the last three are hardening and the batch the
integration suite turned up.

### Arc A: durability (06, 07, 08)

The reconciler that makes a dropped insert a delay instead of a permanent
hole, the delivery diff and sweep beside it, and the counters that say
whether the primary path is rotting. The table's
`non_replicated_deduplication_window` is already sized for this arc, and
the live insert path already carries its deduplication token, so the
schema is committed to a reconciler that does not exist yet. Detail in
issues 9, 10 and 11 below.

### Arc B: the vocabulary gets its writers (09, 10, 14)

`hold_changed` sits in the event-type enum and in a CHECK constraint with
nothing writing it, and `notification_deferred` appears nowhere in the
source. This arc gives them writers, with the silence and inhibition
freezes, and adds `app.alert_state`. Until it lands, the schema promises
rows that do not exist. Detail in issues 12, 13 and 17 below.

### Arc C: attribution and observability (15, 17, 31)

The engine has no spans and no counters, so no operational question about
it has an answer. Ticket 16 already put the actor where the audit journal
needs it, so 17 is unblocked, and 31 extends it to the remaining
mutations. Detail in issues 18 and 20 below.

### Arc D: delivery hardening (23, 28, 29, 30)

Per-recipient delivery state, the alert and runbook links reaching a
notification, bounded recipients and error bodies, and the terminal
failure state that retention needs. Each ticket records which half is
already in place.

### Arc E: deferred by decision (18, 19)

Authorization waits for a real RBAC model. SSRF-safe webhook delivery is
a non-blocking follow-up. Both ship as accepted risks.

### Arc F: found by the integration suite (34 to 47, minus 45)

Thirteen tickets filed while building and testing the pipeline, none of
them fixed. Tickets 39 and 41 already have characterization cases that
pin today's answer, so whoever lands the fix flips the expectation rather
than writing the case. 46 and 47 came out of the read of the flush claim
and the routing lookup.

## Referenced detail

The tickets in arcs A, B and C point at the issue numbers below for
detail. The issues for shipped work are gone; the numbering keeps its
gaps so the pointers still resolve.

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
- The window filters on `journaled_at` (shipped with the 0011 riders, see
  [`05-what-shipped.md`](05-what-shipped.md)), evaluated on the
  PostgreSQL clock; it is transaction-start time, so the window carries a
  visibility margin.
- Both window bounds as tested invariants: wider than any plausible outage
  plus the delivery retry span plus the longest journal-writing
  transaction, narrower than min(tenant `logs_days`, the
  90-day journal retention in
  `server/alerting/maintenance/cleanup.ts`).
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

- `packages/app/src/server/alerting/delivery/suppression.ts`
- `packages/app/src/server/alerting/delivery/process-event.ts`

Required outcome: the compare-and-insert runs in one transaction holding
the event row lock, and the previous triple is read from the journal,
never from ClickHouse. The freeze-then-clear sequence disappears. One row
per hold period, not per 60-second re-deferral.

### 13. `notification_deferred` with the freezes

Doc step 6. Needs issue 12; the reserved freeze columns shipped with the
recreation DDL ([`05-what-shipped.md`](05-what-shipped.md)).

Files:

- `packages/app/src/server/alerting/delivery/suppression.ts`

Required outcome: the new event type projects from the decision rows; the
silence comment and matchers freeze onto it and onto
`notification_suppressed`; the inhibiting source freezes into the columns
the recreation DDL reserved. A deferred chain that ends without delivery gets its own
terminal `notification_suppressed` row with a matching `reason`, so "what
is held right now" can close.

### 17. `app.alert_state`

Doc step 8. Both prerequisites shipped, pending and the pause/delete
terminals ([`05-what-shipped.md`](05-what-shipped.md)). Closes scope priority 1. The decision
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

### 20. The audit journal

Doc step 10, second half. Its prerequisite shipped: ticket 16 put the
server-derived actor on every mutation ([`05-what-shipped.md`](05-what-shipped.md)). PostgreSQL only: one audit row
per qualifying mutation, committed at the mutation boundary, read by the
application, with an enforcement boundary no mutation path can skip. The
open decisions (which mutations qualify, actor column shape, snapshot
versus diff, channel config redaction) live in the doc.
