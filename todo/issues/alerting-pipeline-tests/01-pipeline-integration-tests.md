# Integration tests for the alerting pipeline, on PGlite

## Why

The alerting branch adds a five stage pipeline: scan, evaluate, process
event, flush group, send delivery. Every stage reads and writes PostgreSQL,
and most of the interesting behavior is in the SQL: guarded claim stamps,
`FOR UPDATE` re-reads, upserts that must converge, CHECK constraints that
tie an event's kind to its type, cascades that must not orphan a delivery
chain.

None of that is tested. The stage tests substitute the database with
hand-built fluent fakes:

```ts
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: () => ... }) }) },
}));
```

A fake like this returns whatever the test author expected the query to
return. It cannot reject a row, cannot cascade, cannot enforce a unique
index, and cannot notice that the query it stands in for was changed. The
tests pass whether or not the SQL is correct.

This document specifies an in-process integration harness that runs the real
pipeline against a real PostgreSQL, and the tests to build on it.

## Decisions

**PGlite for PostgreSQL.** PGlite is PostgreSQL compiled to WebAssembly and
runs in the vitest process. A spike confirmed the parts that matter:

- All 12 drizzle migrations apply, and all 15 `alert_*` tables are created.
- All 18 graphile-worker migrations apply, and `graphile_worker.add_job` is
  a real callable function.
- `jobKeyMode := 'replace'` collapses two enqueues into one job that carries
  the newer payload.
- PGlite's `now()` follows `vi.setSystemTime`, because its WebAssembly clock
  reads `Date.now`. One virtual clock therefore drives JavaScript and
  PostgreSQL together.

The last point decides the harness design. `for` durations, group waits,
group intervals, repeat intervals, silence windows and retry backoff are all
time-driven, and a single clock makes each of them directly testable.

**PGlite is one connection.** Two workers contending for one row cannot be
reproduced. Tests drive the serialized outcome of a race, for example by
running the losing claim after the winner commits. The comments about
`FOR UPDATE SKIP LOCKED` and lock ordering stay unproven, and this document
does not claim otherwise.

**An in-memory ClickHouse double.** chDB has no working Node binding: the
`chdb-node` package is a 2024 era native addon that fails to build against
current Node, and this repository's `libchdb.so` is consumed from Go and
Rust. A real ClickHouse would also be the first service container the app
test job needs, and `build-and-test-app.yml` runs with none today. So
`@/lib/clickhouse` is mocked. The harness scripts query results per
evaluation tick and captures every row written to `insertAdminRows`, and the
tests assert on the captured rows. The `alert_events` DDL itself stays
covered by the existing row-builder tests in
`server/alerting/history/clickhouse.test.ts`.

**One enqueue statement.** `addWorkerJob` runs through graphile's
`makeWorkerUtils`, bound to the real `pg.Pool`, so it cannot reach PGlite.
`addWorkerJobInTransaction` already writes `graphile_worker.add_job` by
hand. The two are unified on the SQL statement, running through the `db`
executor, and `makeWorkerUtils` leaves `jobs.ts`. Two benefits: the paths
can no longer drift, and the whole pipeline reaches PGlite through the
single `@/db/client` seam. The only other caller is
`server/github-events/enqueue.ts`, whose interface does not change.

**The existing mocked stage tests stay for now.** They are pruned in a
follow-up commit, after an inventory confirms which assertions the
integration suite actually reproduces. Deleting them in the same commit
risks dropping an assertion silently.

## The harness

One module: `src/server/alerting/testing/pipeline-harness.ts`.

### What it builds

1. A `PGlite` instance. It applies the graphile-worker SQL files, with
   `:GRAPHILE_WORKER_SCHEMA` replaced by `graphile_worker`, then the drizzle
   migration files, split on `--> statement-breakpoint`.
2. A `drizzle-orm/pglite` database. `vi.mock("@/db/client")` points `db`,
   `runInTransaction` and the transaction types at it.
3. A job driver. `runJobs()` reads due rows from
   `graphile_worker._private_jobs`, joined to `_private_tasks` for the task
   identifier, dispatches each to the real handler in `alertTaskList`, and
   deletes or retries the row by the rules the real worker uses. Jobs run one
   at a time, ordered by `run_at, priority, id`, until none is due.

### What stays real

The whole PostgreSQL side. Every constraint, CHECK, enum, foreign key,
unique index, `FOR UPDATE`, upsert and CTE runs as written. `add_job` is
the real function, so job keys, replace mode, queue names and transactional
enqueue behave as in production.

### What is substituted

- ClickHouse, as described above.
- `globalThis.fetch`, per test. The providers build their real request
  bodies, and the test controls the response.
- The clock, through `vi.setSystemTime`.

### Isolation and cost

One PGlite instance per test file, built in `beforeAll`. Between tests,
`TRUNCATE` the alerting tables and the graphile job tables instead of
rebuilding. Migration takes about one second per file; truncation takes
milliseconds. These files declare `// @vitest-environment node`, because
jsdom costs time and gives nothing here.

## The tests

Six files under `src/server/alerting/`. Cases map to the branch's tickets
where one exists, so review can check them against acceptance lists that are
already written.

### 1. `pipeline-lifecycle.integration.test.ts`

- A rule with `for: 0` fires on the first breach: one `instance_fired` row,
  one delivery, one outbound request with the rendered body.
- A rule with `for: 5m` stays pending across ticks, then fires. Pending
  never notifies.
- The breach clears. `resolve_after` counts absences, then one
  `instance_resolved` row and a resolved notification.
- Flap: fire, resolve, fire again. Two episodes, two `episode_id` values.
- An outage restarts the `for` clock (ticket 33). A gap longer than two
  intervals moves `pending_since`, so the rule does not fire on the first
  tick after the gap.
- Pause and delete close open instances and stop evaluation.
- The rule's query throws the 1000 row overflow (ticket 43). The rule goes
  degraded, `degraded_since` is stamped once, the failure is journaled, and
  the retry backs off.
- The scanner enqueues, evaluation runs, and `next_evaluation_at` advances by
  the interval with a stable phase offset.
- A label columns change closes the lifecycle it destroys.
- A stale `ruleVersion` in a job payload does not overwrite newer state.
- `journaled_at` is transaction start time, so rows written in one
  transaction share it.
- The lifecycle projection is convergent: running it twice leaves one row.

### 2. `pipeline-suppression.integration.test.ts`

- A matching silence defers the event (ticket 40). The message is muted, the
  bookkeeping is not: the `alert_events` row is stamped silenced and re-queued, and the instance
  still reaches firing.
- The silence expires. The deferred event wakes, notifies late, and the row
  explains the lateness (ticket 38).
- The silence is canceled. The set-based `add_job ... FROM alert_events`
  releases every held event in the same transaction.
- Inhibition holds an event while the source fires, and the 60 second
  recheck wakes it when the source clears.
- A preview rule never notifies. The preview column stays the only record.
- A page outranks a preview and everything that cannot page (ticket 44).
- The silence stores the stable principal next to the display author.
- Every mutation carries the server-derived actor, never a client-supplied
  one (ticket 16).
- A silence matching only some instances of one rule defers exactly those.

### 3. `pipeline-delivery.integration.test.ts`

- Group wait: several instances inside the wait leave in one message.
- Group interval: the second flush waits the interval, not the wait.
- A repeat interval shorter than the group interval (ticket 39). Pinned as current behavior, not as a rule: ticket 39 leaves the intended semantics undecided.
- A group parked on the idle sentinel with `last_flushed_at` still null wakes
  on the next dispatch and takes `now + group_wait` (ticket 41, which records
  that no test reaches this case today).
- A dead channel fails once (ticket 45). A Slack 403 gives one attempt and
  one `delivery_failed` row. A 503 retries to `ALERT_DELIVERY_MAX_ATTEMPTS`
  and stops.
- Telegram fan-out with one permanent and one transient recipient failure
  retries, because a fan-out is permanent only when no retry helps anyone.
- Delivery idempotency (ticket 23): a retried write converges on one history
  row for one `delivery_dedup_key`.
- Deleting a channel that has history does not break the delivery record
  (ticket 32).
- A withheld delivery records its real channel type.
- Losing the group creation race folds into the winner's row, driven
  serially.
- The defer stamp and the dispatch stamp are guarded claims: a second claim
  finds the stamp and does nothing.
- A flush notifies only what is firing now. An instance that resolved between
  dispatch and flush leaves the message.
- Per-channel notification budgets.
- Each provider truncates at its own text limit.
- No error text carries a URL, a token, or a chat id.

### 4. `pipeline-capacity.integration.test.ts`

Each case sits exactly on a documented bound.

| Bound | Value | Case |
|---|---|---|
| `FLUSH_GROUP_MEMBER_CLAIM_CAP` | 500 | 501 members. The newest are delivered, the remainder drains on the next flush, and the oversized group is visible (tickets 29, 35) |
| `ALERT_EVALUATION_SAMPLE_LIMIT` | 64 | 65 instances. Matching ones first, `samples_truncated` true (ticket 24) |
| `MAX_EVIDENCE_ROWS`, `MAX_EVIDENCE_BYTES` | 50, 64KB | Evidence caps and `evidence_truncated` |
| `BODY_MAX_EVENTS`, `BODY_MAX_CHARS` | 20, provider limit | The composed body truncates and states what it omitted |
| `ALERT_DELIVERY_MAX_ATTEMPTS` | 5 | A transient failure burns exactly 5, a permanent one burns 1 |
| Scanner batch | 5000 | 5001 due rules. One batch enqueues 5000, the rest come next tick |
| Stale enqueue cutoff | 15 min | A rule stuck as enqueued is picked up again |

The 5001 rule case is the only large fixture. It inserts in one multi-row
statement, so it stays fast.

### 5. `pipeline-routing.integration.test.ts`

- Direct channels on the rule short-circuit routing. Routes are never read.
- Route priority: the lowest priority number wins, and `continue: false`
  stops the walk.
- `continue: true` fans out. One event makes one group per receiver.
- A route naming a receiver that does not exist is skipped, and the other
  matched routes still deliver.
- Matchers: `eq`, `ne`, a missing label matching as an empty string, and no
  matchers as catch-all.
- A retired regex op never matches, for rows written before its removal.
- `group_by` on the route changes the group key, so two instances that
  shared a group now split.
- Synthetic labels win on collision. A user label named `severity` cannot
  override the system value.
- A rule matched by many routes reaches every one of them. Route fan-out has
  no cap today, and this case pins that: ticket 29's bound is on the
  recipients inside one channel, not on how many routes an event fans into.

### 6. `pipeline-invariants.integration.test.ts`

This file is the reason a real PostgreSQL pays for itself. No mock can
express any of it.

- The `alert_events_kind_matches_type` CHECK rejects a state event written as
  notifying, and the reverse. The CHECK is derived from the vocabulary, so a
  reason added without a CHECK update fails here.
- `alert_instances_definition_fingerprint_uq` makes a repeated instance write
  converge on one row.
- Deleting a rule cascades to instances, direct notification groups and
  memberships. Its deliveries survive ungrouped, because a delivery row is the
  record of a notification and carries no foreign key to the rule.
- The live and preview slug unique indexes coexist: one slug is legal once
  live and once per preview.
- A failed mutation rolls back the job it enqueued. The transaction writes to
  `graphile_worker`, then throws, and no job remains. This is the failure
  mode that silently loses alerts, and no mock can prove it.
- `jobKeyMode: "replace"` collapses two evaluation enqueues for one
  `scheduledFor` into one job carrying the newer payload.
- Partition queue assignment is stable and spreads across the 64 queues.

### Two organizations

One `describe`, run against the pipeline: identical rule slugs, identical
labels and identical receiver names in two organizations. Neither sees the
other's instances, silences, groups or deliveries. Every query in the
pipeline carries `organizationId`, and one missing predicate leaks alerts
between tenants.

## Out of scope

- Retention cleanup, preview teardown, project lifecycle projection and
  organization deletion. Maintenance is a separate increment.
- Apply and the as-code YAML path. Tests insert fixtures directly.
- True concurrency, which PGlite cannot provide.
- Template rendering and provider body shapes, which the existing unit tests
  cover well.

## Order of work

1. Unify the enqueue paths on one SQL statement. One commit.
2. The harness, with a smoke test that fires one rule end to end.
3. Files 1 to 4, one commit each, so the pipeline is covered early.
4. Files 5 and 6.
5. Prune the mocked stage tests the suite now covers, with the list stated in
   the commit message.

All of it lands on `gio/alerting-integration-tests`, branched from
`gio/better-alerting`, so it reviews on its own and does not disturb the
alerting PR.

## Risks

- **PGlite drifts from the production PostgreSQL version.** The migrations
  are plain DDL and apply cleanly today. If a future migration uses something
  PGlite lacks, the harness fails loudly at setup rather than silently.
- **The suite gets slow.** One instance per file and truncation between tests
  bounds it. If it still grows too slow, the capacity file is the first to
  split out.
- **The ClickHouse double drifts from the real writer.** It captures the rows
  `insertAdminRows` receives, so it drifts only if the writer's call shape
  changes, which the type checker catches.
