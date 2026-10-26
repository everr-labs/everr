# Background work and domain events

Everr uses Graphile Worker as a durable command queue. Product capabilities own
product tasks; the cloud composition registers only the additional workers it
owns. An event describes a committed fact. A task asks one handler to produce an
effect. A Graphile `job:success` or `job:complete` listener observes execution,
not a domain transition.

## Composition and execution

`packages/app/src/server/worker/product-worker.ts` combines alerting, optional
GitHub handlers, and preview retention. `combineWorkerTasks` rejects duplicate
handlers, duplicate cron identifiers, and schedules with no handler. Task names
and cron identifiers are persisted contracts, so they stay stable across this
refactoring.

`ApplicationRuntime.registerWorkers()` returns supervised workers without
starting them. The self-hosted composition returns none. The cloud composition
returns the organization lifecycle worker (provisioning, deprovisioning and its
pending scanner). The common
runtime manages the product worker and registered workers as one list, releases
partial startups, and drains all of them before telemetry shutdown. Registration
acquires no running resources. `start()` returns no handle and resolves when
supervision is installed, before a database connection is necessarily ready.
Every `stop()` caller waits for the same drain, including when shutdown overlaps
hot reload. Explicit shutdown rejects on cleanup failure after every worker
cleanup attempt has settled; detached hot-reload failures are logged. A composition
never imports or re-registers the product task list. The shared app imports only
composition contracts, with no cloud package dependency.

Registration is separate from execution capacity. The runners remain embedded
in the web process and share the durable Graphile schema:

| Runner                       | Tasks                                                                                                              | Execution slots | Postgres access                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------- | ------------------------------------ |
| Product                      | Alert evaluation, notification delivery, history projection and retention; GitHub replay/status; preview retention | 2               | Shared app pool                      |
| Cloud organization lifecycle | ClickHouse provisioning, cleanup and recovery scan                                                                 | 2               | Reserved pool, maximum 4 connections |

The reserved organization runner already protects signup from long alert or
GitHub jobs. Removing that isolation would change user-visible readiness
latency. Separate operating-system processes are unnecessary for this change:
`everr-deploy/infra-v2/app.tf` runs one app replica, and neither package has a
standalone worker deployment. Each runner consumes only its registered task
identifiers. Additional cloud handlers can form a cloud-owned task registration
and use a runner according to capacity and latency needs; one event category
does not imply another runner, pool, schema, or process. Do not add unrelated CRM
work to the reserved provisioning runner without revisiting its capacity.

## Best-effort event publication

The event publisher maps committed facts to application-selected
Graphile jobs directly. Publication awaits admission and contains enqueue failures,
with no outbox; Graphile owns durable execution. Self-hosted configures no ancillary routes. Cloud selects CRM routes in configured
and paused modes; only configured mode starts their worker.
Publication becomes active when a composition selects a concrete consumer.

See the [event bus guide](event-bus.md) for the complete emitted-event catalog,
producer boundaries, delivery guarantees, diagnostics, and examples of adding
Graphile routes and worker handlers. Critical commands that must commit with source
state continue to use the transactional enqueue path described below.

## Facts and effects already present

| Owner                        | Fact or input                                                         | Durable effect                                                                        |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Product alerting             | Journaled firing, resolution, closure, suppression and hold decisions | Dispatch an alert event, flush a notification group, send a delivery, project history |
| Product GitHub integration   | Verified provider webhook, an external input                          | Replay to the collector and update workflow status, as separate consumer commands     |
| Product maintenance          | Due evaluation or retention schedule                                  | Evaluate a rule or delete expired resources                                           |
| Cloud organization lifecycle | Organization creation/deletion                                        | Provision or remove its ClickHouse access; provisioning completion changes readiness  |
| Cloud billing                | Verified Polar subscription input                                     | Validate identity and ordering, persist subscription and organization plan            |

Alert domain facts remain in the existing Postgres journal and domain tables.
`alerts/process-event` carries an event ID, not an extensible bus message.
Provisioning is a command, not an `organization.created` event. Its successful
Graphile completion is not sufficient evidence of organization readiness: the
handler can legitimately finish by cleaning up an organization already deleted.

Billing currently runs synchronously in authenticated commands and Polar
webhook callbacks. There are no billing Graphile tasks to move. Its identity
locks, provider verification and timestamp checks must remain in place. Moving
those checks to a background job would change when checkout/access succeeds and
when a provider webhook is acknowledged. Future ancillary billing consumers
belong in cloud, after the authoritative local change.

## Durability, transactions and replay

For critical commands, enqueue through `addWorkerJobInTransaction` or
`addWorkerJobUsing(tx, ...)` when a Postgres mutation creates required work.
These helpers use Graphile's public SQL function, so domain state and execution
intent commit or roll back together. Ancillary business-event publication above
deliberately has a different guarantee. Enqueue
failure, including a NULL result under job-key contention, is an error. An
after-commit hook or an in-memory emitter cannot provide this guarantee.

Organization creation commits pending readiness, the initial billing row and
provisioning intent atomically in the Better Auth persistence adapter. Deletion
commits local resource cleanup, organization deletion and deprovisioning intent
atomically. Automatic signup organization creation remains a separate
post-session workflow: a failure can leave a valid User/session with no
Organization. The existing minute scan repairs pending organizations without
jobs. It does not recover a missing automatic organization.

The two GitHub consumer jobs now commit in one transaction before the HTTP
handler acknowledges the webhook. A second enqueue failure rolls back the first.
Retries can still repeat already completed effects; a job key coalesces pending
work, not lifetime delivery history.

Cloud lifecycle payloads now write `{ version: 1, organizationId }`. Workers
also accept the previous unversioned shape as v1 and reject unknown versions
before effects. The additive field works with previous workers, whose parser
ignores unknown fields. Keep this reader compatibility while persisted jobs
may exist. Future incompatible changes need an explicit reader/upcaster or a
new task identifier with an old handler retained until its backlog drains.
Existing alert and GitHub payloads keep their current contracts; this change
does not rewrite queued jobs.

Execution is at least once. Named queues serialize lifecycle actions per
Organization, while idempotent ClickHouse DDL and readiness checks make retries
safe. Lifecycle `unsafe_dedupe` is intentionally restricted to immutable,
state-based repair commands: scans must not reset attempts, replace running
work, or revive exhausted jobs. The per-organization queue does not itself make
an external effect exactly once. Alerting retains its existing journal,
evaluation markers, delivery deduplication and partition queues. An external
notification may still be repeated if its destination accepts it just before
the worker loses the acknowledgement or local completion write.

Product retry budgets remain feature-owned. Organization commands retain 1,000
attempts with jitter and a 30-second delay cap, persisted failure before
rescheduling, startup recovery and periodic recovery. Exhausted jobs stay
available for inspection and explicit restart. Supervisors retry runner failures
independently every five seconds. Graphile's
[job-key semantics](https://worker.graphile.org/docs/job-key) explain why
`replace` is not an exactly-once guarantee and why `unsafe_dedupe` must not be
used for arbitrary changing events.

## Lifecycle facts

Shared identity owns committed User, Organization and Membership facts. Cloud owns
accepted subscription and Plan transitions and publishes shared storage readiness
after the guarded pending-to-ready update commits. Source failures remain real
errors; ancillary publication failures do not change a completed source operation.
See the [event catalog](event-bus.md#emitted-event-catalog) for exact payloads and
commit boundaries. Critical provisioning and billing behavior stays synchronous
or transactionally admitted as described above.

## Operations

Existing job lifecycle logs, feature spans, organization retry errors and the
pending/stalled health snapshot are unchanged. `server/worker/events.ts` handles
Graphile execution diagnostics only. Do not treat its log records as durable
business events. When adding telemetry, use OTel semantic conventions where
available and `everr.*` for custom attributes, correlate job/subject/trace IDs,
avoid credentials or CRM payloads, and verify actual ingestion with Everr.
Some existing product diagnostics still use legacy custom attribute names;
renaming them and their deployment dashboards is outside this refactoring.

SIGTERM/SIGINT run the existing shutdown hook: drain all runners, drain retry
reschedules and startup recovery, close the reserved pool, then flush telemetry.
ClickHouse provisioning receives the existing abort signal after five seconds.
A hard kill can leave database locks; inspect the public `graphile_worker.jobs`
view and follow the cloud README and deployment provisioning runbook before
unlocking confirmed-dead worker IDs. Runtime isolation does not change the
shared web process's failure or deployment grace-period envelope.
