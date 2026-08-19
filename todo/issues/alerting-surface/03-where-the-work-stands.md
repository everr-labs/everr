# Where the alerting work stands

The design overview is
[`02-alerting-clickhouse-surface.md`](02-alerting-clickhouse-surface.md).
The code is the source of truth for both; when this file disagrees with
the code, the file is wrong.

What is left comes first, because it is what anyone picking the work up
needs. What shipped follows as a short reference, organised by theme.

Executable tickets live in [`tickets/`](tickets/), one file per ticket
with its blockers and its own detail. Work any ticket whose blockers are
all done.

## Before a deploy

`drizzle/0011_robust_cardiac.sql` drops the earlier alerting tables on
purpose. Breaking changes and the loss of earlier alert configuration
are accepted at this release stage. It is the only alerting migration:
the branch carries one, rather than a chain of riders.

**The delivery worker needs restricted egress.** This is ticket 06's
decision of 2026-08-16. The application guard already refuses internal
literals, resolves names with `all: true` and rejects any blocked
address, forbids userinfo and non-http schemes, and refuses redirects.
What is left is a DNS rebinding window between that lookup and the
send's own. It is closed in the network, not with a pinned dialer. A
release that skips it ships the window open.

Two P1s are knowingly outside the merge gate: 05 (authorization, waits
for a real RBAC model) and 06 above.

## What is left

Phase 1 was the changes that cannot be undone later: the final table
shape, the row builders,
the migration, tenancy and the skill file. Phase 2 is additive, and no
ticket in it needs a migration or a table recreation. Until it lands the
surface is best effort, and an absent row means unknown.

The 21 open tickets group into six arcs.

### Arc A: durability (01, 19, 21)

There is no reconciler and no schema support for one, so a dropped
insert is a permanent hole by decision rather than by omission.
What is left is measuring it (01). Then stopping an abandoned delivery
from evading retention forever (19), and journaling the one stream whose
absence must not read as healthy (21). The deduplication window and the
insert token stay, because a Graphile retry must converge on one write
whether or not repair ever lands.

### Arc B: the vocabulary gets its reader (02)

Every event type has a writer. What is missing is `app.alert_state`, so
"what fires now" stays answerable only in the application, which reads
PostgreSQL.

### Arc C: attribution and observability (03, 04, 11)

The engine is instrumented. Every job runs as its own root span, linked
to its enqueuer, and four metrics cover evaluations, transitions,
notifications and fire-to-page latency. What
03 still owes is narrow: a span for the rule query itself, the produced
row ids on the evaluate span, and a real classification of user-authored
SQL errors. Today those errors never set ERROR, because nothing throws.
That is the right outcome, reached by accident. The actor plumbing the audit
journal needs has already shipped, so 04 is unblocked and 11 extends it
to the remaining mutations.

### Arc D: delivery hardening (07, 08, 09, 10, 18)

Per-recipient delivery state. The alert and runbook links reaching a
notification. Bounded recipients and error bodies. The terminal failure
state that retention needs, and a terminal that says why it ended. Each
ticket records which half is already in place.

### Arc E: settled by decision (05, 06)

Authorization waits for a real RBAC model and ships as an accepted risk.
Ticket 06 is deployment configuration, not application work; see
Before a deploy.

### Arc F: found by the integration suite (12, 13, 14, 15, 16, 17, 20)

Filed while building and testing the pipeline.

## What shipped

Organised by theme.

**The journal.** `alert_events` holds one row per decision. A `kind`
column (`notifying` or `state`) separates rows a delivery may act on
from rows that only record what happened. `instance_closed` is the
non-notifying terminal, and `reason` says which cause closed it, so a
closure never renders as a recovery. Journal ids are UUIDv7.

**The history table and its writers.** The change that cannot be undone
later. `app.alert_events` in its final
shape, with the row builders in the same commit, because they must match
the DDL. Non-delivery rows are minted UUIDv7. Delivery, hold and
suppression rows take deterministic ids, so a retry converges instead of
duplicating. Labels are capped and provider error text is sanitized at
the write boundary.

**Reading the history.** The tenancy template every future alerting
object copies: the grant, a default-deny row policy, and
per-organization policies from provisioning code. The caller-facing
artifact is the skill file
`crates/everr-core/assets/skills/everr-use-telemetry/rules/alert-history.md`.
The permission transcript was verified on dev, including default deny
returning zero rows before the per-organization policy exists.

**State rows can never be delivered.** `delivery/journal-reader.ts` is
the pipeline's only way to read the journal, and every read hard-codes
`kind = 'notifying'`. The evaluator is a second fence: it never enqueues
process jobs for state rows.

**The instance lifecycle.** `instance_pending` on entry to the
for-duration, and `instance_closed` when the condition clears early.
Pause and delete close their instances in the mutation's own
transaction, cancel the whole delivery chain, and enqueue the projection
transactionally. Membership and the processed stamp commit together, and
the stamp is guarded, so each chain gets exactly one terminal whichever
writer commits first.

**Attribution.** `AlertingActor` (`user`, `apikey` or `system`) at the
session-narrowing boundary. The client cannot set a silence author: Zod
strips it, and the server writes the column.

**Applies and cleanup.** The reconciler writes through the transaction
executor the resource registry supplies. Rule mutations nest as
savepoints, and evaluation jobs are enqueued in the same transaction, so
a rolled-back apply leaves no orphan job. The executor parameter is
required, so a missed call site fails to compile.

**Matchers are exact match only.** `regex` and `notregex` are gone, with
the evaluation path and its unbounded cache. No user pattern reaches
`RegExp` anywhere in the alerting tree.

**Preview scope, charts and lists.** Preview identity threads through
the history query, and `EVERR_PREVIEW_ALERTS=off` gates the scanner.
Downsampling builds a required set first (range edges, failures, every
transition), then fills the rest with the even grid.

**The pipeline runs against real databases.** PGlite holds PostgreSQL in
the vitest process, and chdb holds ClickHouse with the shipped DDL. A job
driver dispatches `graphile_worker` rows to the real handlers, and one
virtual clock drives both. Only outbound HTTP is a double. Eleven files
cover the pipeline. Two limits are real: PGlite is one connection, so
true concurrency stays unproven, and chdb has no row policies, so the
harness cannot prove ClickHouse tenant isolation.

**Fixes from review and testing.** Notification history no longer makes
a channel undeletable. The `for` clock restarts after an outage, because
`for` promises the condition held continuously. A permanent failure
fails on the first attempt for every channel type. A group parked on the
idle sentinel wakes again. An evaluation error is sanitized on every
path, not only the ClickHouse copy.

## Delivery has one destination model

Every alert goes to the organization's **default destination**
(`alert_default_channels`: tier `all`, or split by severity), unless its
rule names `spec.notifications.channels`. Grouping is fixed: by rule and
severity, wait 10s, interval 300s, with no repeat of a notification
already sent. Silences are the only suppression mechanism. Apply warns
rather than failing on a missing channel, and channels are always
deletable, since rules fall back to the default destination.

An Alertmanager-style routing tree (routes, receivers, inhibitions,
repeat intervals) was tried here and rejected. Do not re-add one without
new evidence.
