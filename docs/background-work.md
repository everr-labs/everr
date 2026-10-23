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
returns the organization lifecycle worker, whose task list contains provisioning,
deprovisioning, and the pending-organization scanner. The common runtime manages
the product worker and registered workers as one list, releases partial
startups, and drains all of them before telemetry shutdown. Registration acquires
no running resources. `start()` returns no handle and resolves when supervision is installed, before a database connection
is necessarily ready. Every `stop()` caller waits for the same drain, including
when shutdown overlaps hot reload. Explicit shutdown rejects on cleanup failure
after every worker cleanup attempt has settled; detached hot-reload failures
are logged. A composition never imports or re-registers the product task list.
The shared app imports only composition contracts, with no cloud package
dependency.

Registration is separate from execution capacity. Both runners remain embedded
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

## Best-effort business event publication

`server/business-events/runtime.ts` composes `events.publish(fact): void` from
`ApplicationRuntime.businessEvents`. Features own typed definitions and payload
validation; the application supplies static definitions and subscribers. Both
applications register the shared User, Organization, and Membership definitions
with empty subscriber arrays. CRM handlers remain disabled.

A producer calls publication after its source commit succeeds, using values
already available from that operation. Publication constructs an ID and occurrence
time, validates the fact, and schedules independent subscriber enqueue attempts in
microtasks. A subscriber can throw or reject without preventing siblings from
running or changing the source result. `businessEventSubscriber` preserves the
feature's payload type when adapting its consumer for static routing. The producer
interface has no transaction argument, and this module persists no outbox.

Features depend on `BusinessEvents<FeatureFact>` to restrict their producer input;
the application runtime routes the broad fact interface. A feature parser receives
fact-shaped input without publisher metadata. It must leave its input unchanged
and return independent payload values, as Zod object schemas do. Treat facts as
immutable: the publisher freezes only the envelope and does not deep-clone data.

At most 128 publications are in flight per publisher. Excess publications are
dropped immediately with diagnostics rather than queued or awaited by the
request. Normal shutdown closes publication admission and waits up to five seconds
before stopping workers, then flushing telemetry. A timed-out enqueue may settle
later and still has rejection handling; hard termination can lose accepted facts
and diagnostics. Constructor configuration errors remain startup errors.

Failures emit `business_events.publication.failed` and increment
`everr.business_events.publication.failures` (unit `1`). Failure stages are
`validation`, `envelope`, `subscriber`, `overload`, `closed`, and `drain`. Counter
attributes are only the registered event type (or `unknown`), static subscriber ID
(or `publisher`), and stage, under `everr.business_event.*`. IDs and exception
attributes belong on logs. Payload validation errors are redacted before logging;
subscribers must keep secrets and contact payloads out of exception messages.
Logger and counter failures are guarded independently and never recurse.

This best-effort path is for ancillary consumers. Existing transactional worker
commands below retain their current failure and durability guarantees. Retries
begin only once a subscriber successfully persists its own Graphile job. Feature
cloud consumers are subsequent implementation tickets.

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
a publication failure never changes the committed source result. Direct cloud
billing Membership repairs and downgrade removals, plus provisioning readiness,
remain task 04.

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

Enqueue through `addWorkerJobInTransaction` or `addWorkerJobUsing(tx, ...)`
when a Postgres mutation creates work. These use Graphile's public SQL function,
so domain state and execution intent commit or roll back together. Enqueue
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

## Future CRM facts, without implementing an integration

| Candidate fact        | Owner and authoritative transition                                                                                                   | Future consumer responsibility                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| User created          | Shared identity, committed User insertion, regardless of email/password or OAuth entry                                               | Cloud may upsert a contact keyed by User ID                 |
| Email verified        | Shared identity, actual false-to-true verification transition, not every User update or session                                      | Cloud may update that contact's verified identity           |
| Organization ready    | Shared meaning of storage readiness; cloud owns the ClickHouse transition from pending to ready                                      | Cloud may upsert a company keyed by Organization ID         |
| First valid ingestion | Shared ingestion meaning; durable accepted/stored telemetry for an Organization, not a key creation, UI visit, or provisioning probe | Cloud may record activation once per Organization           |
| Subscription changed  | Cloud billing, accepted newer subscription state after provider identity and timestamp validation                                    | Cloud may update the company's plan and subscription fields |

A User can belong to several Organizations. Contacts represent Users; companies
represent Organizations. Plan and subscription belong to the Organization and
must not be copied onto a User as a single personal plan. Readiness, first valid
ingestion and a paid subscription are independent facts.

No new fact stream, CRM handler, first-ingestion detector, external account or
CRM network call is introduced here. When a concrete consumer is added, use a
small typed contract owned by the feature, with a stable event ID, payload
version, occurrence time and subject ID. Capture the fact and consumer job in
the authoritative transaction; the cloud composition supplies only its
handlers. An optional feature-specific transaction participant is enough if
shared identity must enqueue cloud work. Do not make shared identity depend on
a CRM SDK or cloud event types, or register shared domain handlers twice.

For subscription facts, enqueue inside `saveSubscription` only when the
conditional upsert actually accepts a newer provider revision, in the same
transaction that writes the subscription and plan. For readiness, enqueue only
when the guarded readiness update returns a transitioned row. For ingestion,
Postgres and ClickHouse cannot share that transaction: a durable per-organization
activation marker plus a repair/reconciliation strategy must be designed with
the ingestion path before promising a reliable fact. The existing ClickHouse
journal projection is a precedent for repair, not an activation detector.

For independent consumers, persist separate commands with consumer-specific
idempotency keys. For a CRM projection, upsert by stable Everr IDs and read the
latest authoritative state so delayed jobs cannot regress a newer plan or
email. External calls need bounded timeouts, Graphile's abort signal where
supported, and idempotent provider requests where available. A generic event
bus, catch-all event task, or long-lived event archive has no current consumer
requirement and is deliberately absent.

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
