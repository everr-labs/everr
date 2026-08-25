# 21: A broken rule stays durable

**What to build:** an `evaluation_failed` row in the PostgreSQL journal,
committed with the failure it records, so the one stream that must never
read as healthy has a durable record to repair from.

**Details:** the Durability table in
`../02-alerting-clickhouse-surface.md` classifies evaluation failures as
journaled, and argues why: staleness and broken-rule claims are read
from them, so a dropped insert must not read as healthy. Failures are
the low-volume exception path, which is what buys the exception from the
fire-and-forget treatment the 2.2M success rows get.

The code does not do this. `recordEvaluationFailure` in
`server/alerting/evaluation/rule.ts` writes `alert_evaluations` and the
health columns on `alert_definitions` (`last_error`, `degraded_since`,
`consecutive_failures`) inside the transaction, then projects the
ClickHouse row best effort. Nothing inserts an `evaluation_failed` row
into `alert_events`.

The enum already admits it: `alert_event_type` carries
`evaluation_failed`, and the `alert_events_kind_matches_type` check
constraint forces it to `kind = 'state'`, so the row would be born
processed and could never enter delivery. The schema is ready; the
writer is missing.

**Evidence:** `evaluation_failed` appears once in the engine, as an
event type built for ClickHouse in
`server/alerting/history/clickhouse.ts`. No writer inserts it into
`alert_events`.

**What is durable today:** `alert_definitions.last_error` and
`degraded_since`, which the rule detail page renders, plus the
`alert_evaluations` ledger. Both are current-state columns, overwritten
by the next failure, so they answer "is this rule broken now" but not
"when did it break and how often". The doc now says this rather than
claiming the journal row.

**Decide at the ticket:** whether the journal row is the right home at
all, given the health columns already answer the live question. The
case for it is repair: a journaled row is what a reconciler could diff
against, and without it the evaluation-failure stream is the one
journaled stream in the Durability table with nothing to diff. The case
against is that the reconciler does not exist (see the Reconciliation
section, and ticket 01), so the row would sit unused until it does.

**Blocked by:** None; can start immediately. Worth taking with 01 or
with the reconciler, since its value is repair.

**Status:** needs-decision
