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
pending scanner), plus the independent CRM runner in configured mode. The common
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

| Runner                                  | Tasks                                                                                                              | Execution slots | Postgres access                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------- | --------------------------------------------- |
| Product                                 | Alert evaluation, notification delivery, history projection and retention; GitHub replay/status; preview retention | 2               | Shared app pool                               |
| Cloud organization lifecycle            | ClickHouse provisioning, cleanup and recovery scan                                                                 | 2               | Reserved pool, maximum 4 connections          |
| Cloud CRM integration (configured mode) | User, Company and explicit pair sync/cleanup                                                                       | 1               | Separate reserved pool, maximum 4 connections |

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

`server/events/runtime.ts` composes `events.publish(fact): void` from
`ApplicationRuntime.events`. Features own typed definitions and payload
validation; each static registration pairs one feature definition with its typed
subscribers. Routing is derived from these registrations by event type and version.
Self-hosted supplies no event registrations, so publication is inert. Cloud
registers User, Organization, Membership, billing, readiness,
and milestone CRM consumers, including parent deletion, only in configured or paused
modes. CRM remains disabled by default.
Paused mode persists pending work without starting its integration consumer. See
[cloud CRM execution](../packages/cloud/src/crm/README.md#user-synchronization-and-execution)
for fixed queue serialization, persisted retry budgets and deletion boundaries.

A producer calls publication after its source commit succeeds, using values
already available from that operation. Publication validates the fact, constructs
an ID and occurrence time, and schedules independent subscriber enqueue attempts in
microtasks. A subscriber can throw or reject without preventing siblings from
running or changing the source result. `eventRegistration` infers each
consumer payload from its feature definition. Publication validates once through
that definition, then copies the validated snapshot for each consumer. Persisted
command payload validation remains separate at admission and worker execution.
The CRM worker validates once at its coordinated raw entry, then uses that copied
command for endpoint locks, continuations, execution and deletion cleanup. The producer
interface has no transaction argument, and this module persists no outbox.

Source injection seams normalize publishers once with `safeEventPublisher`.
Producers call `events.publish(fact)` directly after commit. Synchronous throws and
unexpected promise rejections from an injected port are contained and measured,
without awaiting publication or catching source operation failures. Injected failure
diagnostics use a fixed error message, excluding thrown payloads and response bodies.
Each diagnostic emitter is guarded independently.

Diagnostic identities remain stable for existing queries and alerts: the meter
`everr-app.business-events`, counter `everr.business_events.publication.failures`,
log body `business_events.publication.failed`, `everr.business_event.*` attributes,
and shutdown hook ID `business-events` retain their established names.

Features depend on `EventPublisher<FeatureEvent>` to restrict their producer input;
the application runtime routes the broad fact interface. A feature parser receives
fact-shaped input without publisher metadata. It must leave its input unchanged
and return independent payload values, as Zod object schemas do. Treat facts as
immutable: the publisher freezes each envelope and clones the validated payload
with `structuredClone` before scheduling consumers. This preserves a producer
snapshot and prevents one consumer from mutating another consumer's payload.
Registration rejects duplicate consumer IDs and conflicting definitions for the
same type and version before publication starts. A definition can have several
consumers, or none, without requiring a second definitions catalog.

At most 128 publications are in flight per publisher. Excess publications are
dropped immediately with diagnostics rather than queued or awaited by the
request. Normal shutdown closes publication admission and waits up to five seconds
before stopping workers, then flushing telemetry. A timed-out enqueue may settle
later and still has rejection handling; hard termination can lose accepted facts
and diagnostics. Constructor configuration errors remain startup errors.

Failures emit `business_events.publication.failed` and increment
`everr.business_events.publication.failures` (unit `1`). Failure stages are
`publication` (an injected port failure), `validation`, `envelope`, `subscriber`,
`overload`, `closed`, and `drain`. Counter
attributes are only the registered event type (or `unknown`), static subscriber ID
(or `publisher`), and stage, under `everr.business_event.*`. IDs and exception
attributes belong on logs. Payload validation errors are redacted before logging;
subscribers must keep secrets and contact payloads out of exception messages.
Logger and counter failures are guarded independently and never recurse.

This best-effort path is for ancillary consumers. Existing transactional worker
commands below retain their current failure and durability guarantees. Retries
begin only once a subscriber successfully persists its own Graphile job. Feature
cloud consumers persist their own latest-state CRM commands independently.

Shared identity uses `identityLifecycleAdapter` around the provider persistence
adapter. It reuses the real root transaction, retains cloud billing and
provisioning wrappers inside nested Better Auth transactions, and publishes facts
only after that root transaction resolves. Better Auth 1.6.33 database after-hooks
also run after rollback, so they do not establish commit success. Workspace setup
publishes its three inserted identities after its setup transaction commits.
Onboarding publishes its Organization update after the standalone statement
returns successfully.

Organization subjects and payloads contain the stable Organization ID. Membership
subjects are the persisted `member.id`; their payloads retain that Membership ID,
Organization ID, and User ID before removal. Row locks serialize captures, and
Organization and Membership predicates are revalidated after acquiring those
locks. Invitation acceptance, role updates, direct member removal, and leave
therefore describe actual persisted relationships, including a User belonging to
several Organizations.

Parent deletion is a cleanup contract: `identity.user.deleted` requires cleanup
of that User's remote associations and contact; `organization.deleted` requires
cleanup of that Organization's remote associations and company. Future consumers
must use parent IDs and durable remote mappings even when source rows have gone.
Database cascades do not invent individual `membership.removed` facts. Better
Auth explicitly deletes Membership rows before deleting an Organization, so those
real deletes publish captured relationship facts in the same commit.

Better Auth currently commits an Organization insert separately from its creator
Membership insert. If the latter fails, the Organization and its creation fact
remain committed. Cloud provisioning intent stays atomic with the Organization
row. An explicit source transaction rollback discards all its captured facts;
a publication failure never changes the committed source result.

Cloud billing publishes `billing.subscription.changed` after an accepted provider
revision commits in `saveSubscription`. Its conditional Plan upsert publishes
`organization.plan.changed` only for an actual Hobby-to-Pro transition. Inactive
Pro subscriptions retain their Pro Plan and can independently suspend app access.
A Hobby downgrade publishes captured Membership removals and its Pro-to-Hobby
Plan transition after the local transaction, even if subsequent external billing
reconciliation fails. The retained Owner has no fabricated update. Direct owner
Membership repair publishes after its standalone insert succeeds, before later
checkout steps. The provisioning runner publishes shared `organization.provisioned`
only when its guarded pending-to-ready update returns a row; retries and concurrent
attempts that transition no row publish nothing. These ancillary facts preserve
critical provisioning enqueue, cleanup, billing verification, and lock behavior.

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

## Current cloud CRM facts and effects

Shared identity owns committed User, Organization and Membership facts. Cloud
owns accepted subscription and Plan transitions. Shared readiness means storage
readiness; cloud publishes it only after the guarded pending-to-ready update
commits. These producers publish after their source commits. Subscriber failure
cannot change a completed signup, billing operation, consultation or provisioning.
A source persistence or critical command failure remains a real error.

Cloud consumers synchronize Contacts for Users, Companies for Organizations and
explicit pairs for current Memberships. One User can belong to several
Organizations. Plan, subscription, access, readiness and activation remain distinct.
The independent one-slot CRM runner owns outbound requests, deletion cleanup and
periodic current-state repair. It never borrows the reserved provisioning runner.
Self-hosted registers no CRM subscribers, configuration, schema or jobs.

Activation rule 1 observes only the supported standalone trace-detail UI read and
exact raw trace-detail SQL on CLI/MCP, with server-verified scope and conservative
own Production/receiver-shaped CI evidence. It persists first-queryable and
activation markers together through a directly bounded observer, then publishes
their facts best effort. Observation does not construct an intermediate event or
private publisher. Provisioning, usage bytes, keys and billing do not activate an
Organization. Dashboards, other
details, aggregates, preloads/refetches and cached actions without a read remain
unobserved. Historical actions lost before marker persistence remain unknown.
See [supported completion paths](../packages/cloud/src/organizations/README.md#supported-completion-paths-task-11)
for the grammar, provenance and scripted-request limits.

Bootstrap and periodic repair admit current-state commands through short
checkpoint/job transactions, independently of domain publication. These are
administrative admissions, not an outbox or historical event replay. Graphile
execution is at least once after admission; immutable mappings, endpoint locks,
revision guards and retained Company-create intent constrain provider writes.
A missing mapped remote record stays blocked, with no automatic replacement.

The [CRM operations runbook](crm-operations.md) is the current configuration,
field/readback gate, admission, repair, diagnosis and recovery contract. The
[CRM module README](../packages/cloud/src/crm/README.md) records implementation
limits. Campaign/event delivery is outside this rollout.

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
