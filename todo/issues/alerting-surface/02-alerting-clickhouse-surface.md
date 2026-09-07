# The alerting investigation surface

How alerting history becomes queryable through `everr cloud query`.

This is a design overview, not a specification. The code is the source of
truth: for the table's exact shape read
`clickhouse/init/12-create-alert-events.sql`, and for the caller-facing
reference (every column, the event-type table, worked queries) read the
shipped skill file
`crates/everr-core/assets/skills/everr-use-telemetry/rules/alert-history.md`.
That file is the artifact this design exists to produce, so it is kept in
lockstep with the DDL and nothing here restates it.

It supersedes one assumption of
[ADR 0004](../../../docs/adr/0004-run-alerting-on-graphile-worker.md):
delivery history is no longer derived from PostgreSQL delivery records.

## The premise

Everr exposes observability as SQL. Callers read tables directly, not
through fixed screens, and alerting is not exempt.

Two kinds of caller, and the second sets the requirements. A person
writing SQL iterates: an empty result makes them add a cast and run
again. An agent gets one query per tool call, has one endpoint so it
cannot also query PostgreSQL, and reads the schema from a skill file. So
every row must be readable on its own. Every fact worth filtering on is a
typed column, not a map lookup, and schema size is a budget.

The surface answers four questions, in priority order: what fires now,
how an alert behaved over time, whether a notification was delivered,
and who changed what. The fourth is answered from PostgreSQL by the
application, never from ClickHouse.

## The storage split

PostgreSQL is the system of record: the state machine, scheduling,
configuration, in-flight delivery coordination, and the journal of
decisions. ClickHouse holds append-only records of what happened.

There is no mutable replica of live state in ClickHouse. A replica could
miss one `instance_resolved` and report an alert as firing forever with
no way to correct it. Current state is a fold over the transition rows
instead, which cannot diverge from history and can answer "what was
firing at 03:00 last Tuesday".

Alerting gets its own typed table rather than rows in `app.logs`. The
schema is known, and the queries are analytical rather than text
retrieval. A dedicated table also gets partition pruning and a sort key
tuned for the alerting read. The cost is its own grants, row policy, TTL and
reference documentation.

## The write choreography

One invariant governs every writer. **A row that must not be lost starts
as a PostgreSQL journal row.** It commits in the same transaction as the
decision it records. ClickHouse holds projections of that journal.

A stream is either journaled or ephemeral. There is no third category. A
new event type answers one question before it exists: may this row be
lost?

| Stream | Pattern | Why |
|---|---|---|
| Evaluation successes | Ephemeral | Nothing reads an absent success row as a claim |
| Preview terminal rows | Ephemeral | The preview delete cascade removes the journal that would repair them |
| Transitions, pending, holds, deliveries | Journaled | A missing row reads as a negative answer acted on during an incident |
| Evaluation failures | **Intended journaled, today ephemeral** | Broken-rule claims read from them, so a dropped insert must not read as healthy. Ticket 21 |

The classification table is the structural fix: without it each new
stream escapes the durability umbrella until someone notices, and the
first symptom is also the most damaging: a dropped `instance_fired` makes "what
fired in the last hour" return nothing.

Deliveries are the one exception to the order of those steps. No
transaction spans the provider call, so the journal row reaches terminal
status after the effect. That status update is the decision the
projection follows.
Delivery is therefore at-least-once by design. A crash between provider
acceptance and the status update pages twice while the trail shows one
delivery; the trail counts recorded outcomes, not provider calls.

**A journal row records the decision. It does not repair the
projection.** The ClickHouse projection is best effort, and a lost
insert stays lost. See Reconciliation.

## What the engine writes

Seven Graphile tasks: `scan`, `evaluate`, `process-event`,
`flush-group`, `send-delivery`, `project-lifecycle`, `retention`. Five
of them write history.

Ten event types, listed with their meanings in the skill file. Two
correlation ids stitch them together:

- **`notification_event_id`** links one notification's rows. A
  transition sets it to its own id; the hold, suppression and delivery
  rows that follow carry the same value. It exists because ClickHouse
  rows cannot be updated and the facts about one notification arrive
  from three jobs, minutes or hours apart.
- **`episode_id`** links a fire to its resolve, which
  `notification_event_id` cannot: a resolve is itself a notifying event,
  so it starts its own chain. The episode is minted when an instance
  leaves inactive and carried on every lifecycle row until it closes, so
  incident duration is one `GROUP BY`.

### Decisions behind the shape

**Frozen decision columns.** `silenced`, `silence_id`, the silence
comment and matchers, and `context_json` are computed once at write time
and never rewritten. A silence created later does not change the record
of what happened, and a bug in the silencing logic stays wrong in old
rows forever. That is accepted: the table records what the engine
decided, not what it should have decided, and a wrong decision is itself
the fact an investigator needs. Repair re-derives from the journal, never
by re-running the logic.

The frozen silence comment and matchers also make the row legible alone.
A `silence_id` alone is useless to `cloud query`. Silences live in
PostgreSQL, and audit never moves to ClickHouse, so no join can resolve
it.

**`silenced` is meaningful only on hold and suppression rows.** The
evaluation job writes the transition; the silence check runs later in
the processing job. So `WHERE event_type = 'instance_fired' AND silenced`
returns nothing however many alerts were silenced. This is the kind of
confident empty result the whole design exists to avoid, so the skill
file repeats it next to the column.

**`rule_muted` is not silencing.** It is a property of the rule, and a
preview copy is the only cause today. It means the rule never notifies at
all. `silenced` means one notification was withheld. The column
deliberately does not reuse the spec word `suppressed`, which sits one
word away from `notification_suppressed` with an unrelated meaning.

**Every event that opens something has a terminal.** `instance_closed`
is the non-notifying terminal, discriminated by `reason`
(`pending_cleared`, `rule_paused`, `rule_deleted`, `preview_deleted`);
`instance_resolved` stays the notifying recovery. The split keeps the
history honest: "stopped because someone deleted the rule" never renders
as "resolved". Without it, a paused or deleted rule leaves instances open
in the fold forever. A ClickHouse-only caller cannot learn otherwise,
because rule liveness is scheduler state.

**Pause and delete cancel the whole chain,** in the mutation's own
transaction. Instances close and reset to inactive. Unprocessed and
deferred events are marked terminal. Group members are dropped at flush,
and the send job re-checks liveness before the provider call. A chain
that already notified is not suppressed retroactively.

Resume starts fresh, so a still-breaching rule re-pends, re-fires and
re-notifies. That is also the right paging behavior after a rule was
paused for a week and is still broken.

**PostgreSQL must keep what the history references.** Cancelling a
silence closes its window instead of deleting the row: `ends_at` moves to
now, and `canceled_at` is stamped. Nothing is stranded, and the UI can
tell a person's decision from an expiry. Preview deletion is the one
declared exception, which is why its terminal rows are ephemeral.

## Reconciliation: designed, not built

Nothing repairs a dropped insert. An absent row means unknown. The
design needs two columns that do not exist yet, and they land with it: a
write-source marker on the ClickHouse row, and a PostgreSQL-stamped
`journaled_at` on the journal.

One job runs a diff per journaled stream. It subtracts the ids in
ClickHouse from the ids in PostgreSQL for a window, then inserts the
difference. A journal row deleted mid-window only shrinks the PostgreSQL
side, so a deletion can never cause an insert.

Deliveries diff on outcome, not on presence. An attempt's
`delivery_failed` row can land while the final success insert drops. The
pair is then present, nothing is repaired, and the delivery stays
recorded as failed for good.

A duplicate in an append-only table is permanent, and it double-counts
in every aggregate. The defense is idempotence, in two halves. Both are
already in the code, because a Graphile retry must converge on one write
whether or not repair lands.

- **The row.** A row with a derived id must derive every other column,
  `event_time` included. One column that differs makes two permanent
  rows, and no merge collapses them.
- **The insert.** Every insert carries an `insert_deduplication_token`,
  and the table sets a deduplication window. A retried job, an
  overlapping run and an in-doubt async insert converge on one row. This
  half is a bounded window, not a guarantee, so the row half carries the
  weight.

The diff window is bounded on both sides. It must be longer than any
plausible outage plus the maximum delivery retry span, or rows are lost
forever while the journal still holds them. It must be shorter than the
tenant retention and the 90-day journal sweep, or the diff resurrects
expired rows on every cycle. It filters on the PostgreSQL timestamp,
never on the reconciler's process clock.

A repaired row keeps most of its fidelity, because the journal carries
the fingerprint, labels, severity, suppression flags and episode. Four
degradations are accepted, and the write-source column flags them:
at-transition evidence is gone, the scheduled-at time is approximate,
`service_name` can fall back, and delivery targets are rebuilt from the
current channel config.

Count the repairs. The reconciler is the most likely way this table
acquires wrong rows: a rising repair rate means the primary path is
failing, and repairs for rows that were never dropped mean the window is
wrong.

**Rejected alternatives.** A transactional outbox does not work when the
side effect is an HTTP POST to a third party. `ReplacingMergeTree` with
blind re-insert is not available under this sort key: the engine
collapses rows that match the whole sorting key, and `event_time` sits
before `event_id`. A projection ordered by `notification_event_id` is
the escalation if chain reads ever measure slow.

## Constraints

**Nothing irreversible.** ClickHouse is append-only with a TTL, so a
secret written into it stays for the full retention. Best effort covers
losing rows, not writing wrong ones.

- No secrets: no webhook URLs, bot tokens or chat ids, in any column,
  including inside a rendered notification body. Provider error text is
  sanitized before the `error` column.
- No personal data. Delivery rows carry a channel name, never an
  address. The rendered notification body stays in PostgreSQL, where
  erasure is a `DELETE`; the agent-facing content travels as
  `context_json` instead.
- One conditional: `instance_labels` and the frozen matchers come from
  user-authored SQL and can contain anything. They cannot be dropped,
  since labels are the join key for the whole surface. A hard length cap
  is enforced at the write boundary; the no-personal-data rule holds by
  rule, not by mechanism, and the enforcement boundary is still open.

**Self-sufficient.** Answering any of the four questions must not need a
join to PostgreSQL. An agent with one endpoint would return a less
complete answer, and give no signal that it did. Facts a read would
otherwise join for are copied onto the row at write time.

**Excluded on purpose:** scheduling internals, in-flight retry state,
current configuration as truth, and the audit trail. Alerting does not
run locally, so `everr local query` never sees these tables.

## Auditability stays in PostgreSQL

Audit was designed as its own ClickHouse table and cut, for three
reasons that compound. It was the only stream putting personal data into
an append-only store, and every erasure mechanism that followed existed
only to serve it. It duplicated the full per-table cost for the
lowest-priority question at a volume PostgreSQL serves trivially. And
the application, which answers configuration questions today, holds both
connections and is not bound by the self-sufficiency constraint.

What remains is the real work: the audit journal in PostgreSQL and the
actor plumbing that feeds it. The journal is durable, so projecting it
later stays a pure addition if agents ever demonstrably need it.

## Engine instrumentation

Domain facts belong in typed columns; engine operations belong in spans
and metrics, in `server/alerting/telemetry.ts`. Two things about it are
decisions:

- **Every job is its own root span, linked to its enqueuer, never
  parented under it.** Parent-child would claim one trace spans the
  whole chain. That is false for three reasons: `evaluate` fans out one
  event per transition, `flush-group` one delivery per channel, and a
  silence can defer an event for hours. `everr.alert.episode_id`
  reassembles an incident across the traces, and the journal stays the
  source of truth for causality.
- **Attributes live under `everr.alert.*`.** Metric attributes stay
  bounded (outcome, transition, channel type) with no rule id and no
  organization. The high-cardinality identity that operating a
  multitenant fleet needs (tenant, rule, episode) rides the span, where
  it costs nothing per time series.

These spans are also the only cross-tenant view of the engine: the
journal is customer data behind a row policy, so an operator cannot read
it across organizations.

## Tenancy

The template every future alerting object copies: a `SELECT` grant to
`sql_api_role`, a default-deny row policy, and per-organization policies
created by provisioning code looping over `SQL_API_TENANT_TABLES` in
`lib/sql-api-tables.ts`. That constant is what makes the schema-probe
error message and the MCP tool description derive their table list
rather than hand-syncing copies.

Row policies scope every read, so a `cloud query` caller must never add
a `tenant_id` predicate.

Preview rows stay visible until TTL, so live-only is the default
posture: every documented query filters `is_live`, and the exception is
stated once.

## Volume

Per tenant, assuming a 60-second cadence and 50 rules: roughly 72,000
evaluation rows a day, which the 30-day TTL caps at about 2.2 million.
Against that, roughly 400 non-evaluation rows a day, or 36,000 over a
90-day retention. Evaluations outnumber everything else by two orders of
magnitude.

That is what justifies the split TTL, the evaluation partition
dimension, and a full-retention state fold: the fold reads the 36,000,
not the 2.2 million. Revisit the state view window first if the measured
inputs move materially.

## What is left

Tracked in [`03-where-the-work-stands.md`](03-where-the-work-stands.md),
one file per ticket in [`tickets/`](tickets/). The headline gaps:

- **No repair.** A dropped insert is a permanent hole (tickets 01, 21).
- **No `app.alert_state` view,** so "what fires now" is answerable only
  in the application, which reads PostgreSQL (ticket 02).
- **No per-recipient delivery state,** so a partial Telegram fan-out
  re-sends to recipients that already succeeded (tickets 07, 09).
- **No authorization.** Any organization member can rewrite a webhook,
  change the default destination, or pause monitoring (ticket 05).

One design signal is recorded rather than hidden: the reference does not
fit the "roughly a page" budget the premise asks for. 31 columns drive
it to about three.

## Working on this

The work lives on `gio/better-alerting` as PR #343: one branch carrying
the whole alerting stack, with plain commits rather than a cascade.

| Concern | File |
|---|---|
| Table DDL | `clickhouse/init/12-create-alert-events.sql` |
| Caller-facing reference | `crates/everr-core/assets/skills/everr-use-telemetry/rules/alert-history.md` |
| Row builders and the insert | `server/alerting/history/clickhouse.ts` |
| Deterministic history ids | `data/alerting/history/ids.ts` |
| Sanitizing and length caps | `server/alerting/history/content.ts` |
| PostgreSQL schema | `db/schema/alerts.ts` |
| Task list, one span per job | `server/alerting/runtime.ts` |
| Spans and metrics | `server/alerting/telemetry.ts` |
| Scheduler scan | `server/alerting/scheduling/scanner.ts` |
| Evaluation and transitions | `server/alerting/evaluation/rule.ts` |
| Silence checks and holds | `server/alerting/delivery/suppression.ts` |
| Which channels an event goes to | `server/alerting/delivery/targeting.ts` |
| The pipeline's only journal reads | `server/alerting/delivery/journal-reader.ts` |
| Group membership and dispatch | `server/alerting/delivery/process-event.ts` |
| Flush, claim and commit | `server/alerting/delivery/flush-group.ts` |
| Send and the delivery trail | `server/alerting/delivery/send-delivery.ts`, `delivery/history.ts` |
| Channel providers, SSRF guard | `data/alerting/delivery/providers/` |
| Pause and delete projection | `server/alerting/history/project-lifecycle.ts` |
| Retention for both stores | `server/alerting/maintenance/cleanup.ts` |
| History read, ClickHouse only | `data/alerting/history/repository.server.ts` |
| The integration harness | `server/alerting/testing/` |

Paths are relative to `packages/app/src` except the first two.

### Changing the schema

Do not run `drizzle-kit generate`. The convention is to keep iterating on
one migration rather than accumulate a file per change. Edit
`db/schema/alerts.ts`, then fold the DDL into
`drizzle/0011_robust_cardiac.sql`, which creates these tables from
scratch and has not shipped. Patch `drizzle/meta/0011_snapshot.json` to
match, and apply the change to the dev database by hand.

ClickHouse is different again: fresh installs read `clickhouse/init/`,
while existing deployments need a migration whose every statement carries
its own `SETTINGS`. `ORDER BY` and `PARTITION BY` are immutable, so a
change to either means recreating the table. `app.alert_events` can be
recreated only while it holds no history anyone would miss.

### Testing

The pipeline runs against real databases in the ordinary suite. The
harness in `server/alerting/testing/` puts PostgreSQL in the vitest
process with PGlite, and ClickHouse in chdb with the shipped DDL. A job
driver dispatches `graphile_worker` rows to the real handlers, and one
virtual clock drives JavaScript and PostgreSQL together. Every
constraint, enum, foreign key, `FOR UPDATE` and upsert runs as written;
only outbound HTTP is a double. Eleven `pipeline-*.integration.test.ts`
files cover the pipeline end to end.

Two limits are real. PGlite is one connection, so true concurrency stays
unproven and tests drive the serialized outcome of a race. And chdb has
no row policies, so the harness proves the projection's shape, never
tenant isolation.

Prefer an integration case. Reach for a fake only for what the harness
cannot produce: a write that throws mid-transaction, a claim lost to a
concurrent cancel, a query that rejects.

For ClickHouse, verify ingestion with `everr-dev` rather than assuming.

## Settled: do not reopen without new evidence

Measured on a dev instance at ClickHouse 26.2 under review:

- The partition key prunes through a monotonic function of `event_time`,
  so a plain time bound needs no second predicate. A `set` skip index
  does **not** work here, because every rule contributes one row of each
  event type to its granule range; the evaluation split had to be a
  partition dimension instead.
- The chain point read works through its derived UUIDv7 time bound, and
  the bound survives arbitrarily long holds. It is not optional.
- The sort key serves the dominant per-alert read. Two queries it does
  not serve (tenant-wide questions, and chain lookup) are covered by the
  partition prune and a bloom index.
- The `ReplacingMergeTree` rejection, the conditional TTL, and the
  argument that a preview cascade cannot cause an insert.
- One table, not several. Revisit only if per-event-type column sparsity
  becomes a measurable cost.
- Alerting does not belong in `app.logs`. No view or projection carries
  alert rows there.
- Previews stay visible with `is_live` as the default filter.
- Matchers are exact match only. `regex` and `notregex` are gone,
  including the evaluation path and its unbounded process-wide cache, so
  no user pattern reaches `RegExp` anywhere in the alerting tree.

## Open questions

- **The redaction boundary.** Labels and frozen matchers come from user
  SQL and cannot be dropped. They land with a length cap, while the
  no-personal-data claim holds by rule. A documented rule is likely to
  be violated, so this probably needs a type or lint boundary that makes
  the unredacted path unrepresentable.
- **Cost at tenant scale**, measured rather than assumed.
- **How far the pattern generalises** to CI runs, apply history, and an
  organization-wide audit log.

## Delivery has one destination model

Every alert goes to the organization's default destination, optionally
split by severity, unless its rule names `spec.notifications.channels`.
Grouping is fixed by rule and severity. Silences are the only
suppression mechanism.

An Alertmanager-style routing tree (routes, receivers, inhibitions,
repeat intervals) was tried here and rejected. Do not re-add one without
new evidence.
