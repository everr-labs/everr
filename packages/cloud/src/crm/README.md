# Cloud CRM projection state

For current configuration, schema and provider field prerequisites, rollout,
pause and diagnosis, use the [operations runbook](../../../../docs/crm-operations.md).
Its field inventory plus owned-fixture readback is a mandatory pre-enable gate.
Environment validation alone does not prove schema, fields or the deployed build.

This module stores desired CRM state and includes cloud-only User, Organization and
Membership consumers, an independent integration runner and the [Brevo adapter and request budgets](brevo/README.md).
The [event bus guide](../../../../docs/event-bus.md) catalogs emitted facts and explains Graphile handler wiring.
The integration is disabled by default and makes no startup provider calls. Cloud's schema entry point exports
`crmProjection`; the shared and self-hosted schema/composition do not import it.
Cloud migration `0002_crm_projection` creates the projection, account budget and
bootstrap/reconciliation checkpoint tables after `0001_organization_milestones`.
Generation is separate from applying those migrations to a target database.

## Identity and ownership

A stable deployment namespace is a required argument to the reader and store. It
must identify the deployment permanently, independently of its hostname. The
versioned external ID encodes that namespace, entity kind and source ID. A User
maps to a Contact; an Organization maps to a Company. A Membership association
maps the User/Organization pair, independently of a Membership row ID or email
domain. One User can belong to several Organizations. Never change a deployment
namespace after syncing its records without a deliberate mapping migration.

Contact external identity is intended for Brevo's `ext_id`. Company identity uses the `EVERR_ORG_ID` attribute label (verified provider internal
name `everr_org_id`), alongside its persisted provider ID.
The adapter owns provider request formatting and bounded recovery. Custom
product attributes use the `EVERR_` namespace; the desired snapshot uses the local
field names below. Source IDs are deployment scoped before leaving Everr.

| Projection   | Source-owned fields                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User         | Name, email, original registration date, verified status                                                                                                                                     |
| Organization | Name, creation date, Plan, app access state, subscription status, current period end, scheduled cancellation, provisioning state, observed first-queryable/activation dates and rule version |
| Membership   | Current explicit User/Organization association; snapshot membership IDs and roles describe authoritative membership state                                                                    |

Everr owns exactly those profile fields and associations. Brevo owns notes,
communication preferences, consent and opt-outs. None of those CRM-owned values
are in desired state. An adapter must update only owned fields and preserve
opt-outs during email changes. The desired snapshot describes Everr-owned state,
not the entire remote record, and cannot prove the CRM has not drifted.

Plan, subscription status and effective app access are distinct. The snapshot
reader calls the same `readOrgEntitlement` policy as the app, with the snapshot's
transaction executor, including catalog validation. An active Pro subscription
scheduled to cancel still grants Pro access. Past-due Pro remains Plan Pro with
suspended access. Provisioning uses the existing readiness policy, including its
legacy-ready behavior. Activation and first-queryable dates come only from the
cloud [verified milestone store](../organizations/README.md), in the same snapshot
transaction. Missing markers remain null (unknown history), never false or an
invented historical date. Readiness never implies activation. Milestone and
`organization.provisioned` facts do not enqueue CRM work. These fields refresh
when another subscribed fact, bootstrap or reconciliation admits Organization
synchronization. Plan, access, subscription and readiness ownership remain independent.

## Reading and persisting

`createCrmSnapshotReader` accepts only source IDs, never event payload copies. User
and Organization reads use a read-only repeatable-read transaction so profile,
billing and Memberships share one committed view. Membership reads test whether
the pair currently exists. Missing sources produce identity-only deletion desired
state without retaining old contact fields. Membership arrays have stable ID order.

`createCrmProjectionStore` supports reading desired state, persisting a desired
snapshot, binding remote IDs, marking success/failure, and guarding retry allowances.
PostgreSQL compares the desired JSONB directly, ignoring object key order and preserving
the reader's stable membership array order. Identical snapshots retain the revision and
previous outcome. Explicit remote checks, cleanup rechecks and exhausted-work recovery
can open a new guarded revision. Changed desired state increments the revision and
becomes pending, retaining the prior synchronized revision and success time. Completion and failure updates require the
current desired revision. A late failure cannot overwrite success for that same
revision. Failure codes are bounded identifiers, never provider response bodies,
contact payloads or secrets. Binding remote IDs is separate from completion so an
old or ambiguous creation result can be retained even when desired state advanced.
Bindings cannot silently replace an already recorded remote identity.

The same cloud table holds entity and relationship mappings, with explicit local
User/Organization endpoints for associations, their available remote Contact and
Company IDs, and independent desired/synchronized revisions. It has no foreign
keys to source rows. Source cascades therefore cannot discard remote cleanup
identity. A handler must bind association endpoint IDs when they become known,
before recording a successful link. Retain mappings and deletion tombstones after
remote cleanup for reconciliation and stale-job protection. Entity tombstones
are terminal because source IDs are not reusable. Removed Membership pairs can
be added again with a newer revision and the same stable external identity.

The store is a persistence seam, not outbound-write coordination. The workers
serialize each entity's load, desired-state update, provider work and outcome
across replicas, then reread current source state for subsequent work. Revision
guards protect local acknowledgements, but cannot prevent an old in-flight HTTP
request finishing after a new one. Association consumers must ensure both endpoint
mappings exist, reconcile additions and removals, and coordinate them with parent
deletion. No source transaction is held open during provider calls.

## User synchronization and execution

Cloud registers consumers for User creation, updates, deletion and email verification in
`configured` and `paused` modes. Each route builds an ID-only
`crm/sync-user` command. The shared publisher directly awaits Graphile admission,
containing enqueue failures in one place. Disabled mode registers no
consumers or integration runner; self-hosted imports none of this module. Paused
mode keeps admitting commands but starts no CRM consumer, preserving pending jobs.
Missing enabled configuration fails validation rather than consuming work.

The coordinated Graphile entry strictly validates each persisted version-1 command
once, before acquiring a pool connection. Its copied command supplies endpoint
locks, contention scheduling, concrete execution, deletion cleanup and Membership
fanout. Invalid jobs retain the existing bounded diagnostic and inspection policy
before source reads or provider calls. Commands contain no retry-count or desired-revision
mirrors: the projection row is the sole retry authority. Explicit
`recoverExhaustedRevision`, `verifyRemoteRevision`
and `recheckDeletionRevision` remain guarded instructions. `eventType` records a bounded
origin label rather than selecting historical state to replay. Membership prerequisites
preserve that origin and event ID for both parents, without copying the pair's expected
revision instructions onto a different projection.

Configured mode registers `everrIntegrationWorker` with one execution slot and a
reserved pool of at most four connections. The existing managed supervisor owns
startup rollback, retry, HMR and shutdown, independently of product and organization
provisioning capacity. Shutdown cancels provider requests and short permit waits,
then stops the runner and drains retry bookkeeping before closing its pool.

Every User job uses one of 64 fixed Graphile queues, hashed by source User ID.
Graphile serializes that queue across replicas for the entire source read, desired
state save, remote lookup/write and outcome. Keep this partition mapping stable
while any admitted jobs remain. No domain transaction spans HTTP. The handler
reads current authoritative state, honors terminal tombstones returned by the store,
and rechecks the source after lookup and after HTTP. Changed state receives another
persisted attempt rather than acknowledging stale success. Identical synchronized
revisions skip provider work; contact updates omit unchanged Everr-owned fields.
Remote mapping conflicts block work and never merge contacts.

An external request cannot be atomic with source deletion. A deletion that commits
after the final source check can still race an already-started HTTP request. The
post-request check captures a terminal tombstone and retains any remote ID for
cleanup, without marking it synced. Missing sources never initiate contact creation.
The next coordinated execution cleans the retained remote identity after deletion.
Missing sources never initiate contact creation, and terminal tombstones prevent stale
upserts from recreating deleted entities.

Known transient/ambiguous failures retain the reserved database allowance and
persist a successor with exponential backoff (up to one hour), honoring any later
adapter `retryAt`.
Each desired revision has eight durable failure allowances. Before HTTP, the store
reserves one allowance with revision/count guards. Known quota/pause/cancellation
deferrals refund it before scheduling. Success and changed desired state reset the
count. `crm_projection.retry_failures`, scoped to the desired revision, is the sole
provider-retry authority. Replays and coalesced jobs cannot replenish it. Native
Graphile attempts separately cover infrastructure and successor persistence
failures. A crash
or unexpected failure after reservation conservatively spends the allowance,
including when no HTTP reached the provider. This bounds admitted executions and
does not claim atomic provider/database receipts or exact external request counts.
An exhausted projection prevents further HTTP even if successor insertion failed
and Graphile retries an older payload. Each successor is inserted
before its predecessor completes, so a crash can duplicate work but cannot erase
the persisted retry. Contact external-ID uniqueness permits lookup recovery after
an ambiguous create; any returned remote ID is bound before recovery. Company create recovery is described below. Normal contact permit gaps wait at most 250 milliseconds
with cancellation; longer gaps defer durably. Company reads persist their owned-field response before PATCH, so the next
36-second general permit can resume the write without repeating GET.

Graphile additionally retains an eight-attempt native fallback for database or
successor-insertion failures, with sanitized errors. The durable reservation
survives that retry. A crash after HTTP but before successor insertion can repeat
an idempotent contact lookup/write only while allowance remains. Terminal failures use the public
`permanently_fail_jobs` API after Graphile unlocks the job; if that optimization
fails or the process dies, blocked/exhausted state short-circuits subsequent HTTP
and native retries still retain the job. Exhausted/blocked jobs remain available
through Graphile's public inspection/replay APIs, with no automatic cleanup.
Graphile replay alone does not reset projection blocks or exhausted allowances.
The guarded recovery command below only admits exhausted revisions; ordinary
blocks with fewer than eight failures and mapped missing records require separate
inspection and a supported recovery procedure.

## Organization and explicit Membership synchronization

`organization-sync.ts` and `membership-sync.ts` own separate typed handlers,
registered directly in `task-list.ts`. Each handler keeps its source rereads,
revision checks and retry reservation visible in its concrete execution path.
Both use the same projection store and endpoint coordination. Organization and
User completion enqueue related pairs through `enqueueMembershipSyncs`.

Cloud also subscribes to Organization creation/updates, explicit Membership additions,
updates/removals, deletion, subscription and Plan facts. Readiness and milestone
facts have no CRM routes. Commands contain source IDs only.
Two Organizations sharing a domain keep distinct Company IDs. A Contact can link to
several Companies, and unlink removes only the requested pair. Membership row replacement
and stale event order are resolved by rereading the latest User/Organization pair.

`createCrmTaskList` wraps all three task types with PostgreSQL session advisory locks.
Parent tasks lock their endpoint; association tasks try both endpoint locks in sorted
order and defer immediately on contention. There is no source transaction across HTTP.
The existing 64 User Graphile queue partitions are unchanged, with another 64 fixed
Organization/association queues. Stable projection job keys and `preserve_run_at` coalesce
source events, prerequisites, fanout and continuations. Retry progress lives in the
revision-scoped projection allowance, so replacing an unlocked payload cannot replenish
it. Prerequisite waits enqueue parent work and defer for at least 60 seconds. Parent
fanout runs after successful/already synchronized work, preventing a quota-deferral
feedback loop. The one-slot runner never waits for its own queued task.

Company creation persists `company_create_attempted_at` before non-idempotent POST.
A crash after intent, provider acceptance or failed local binding resumes bounded
inventory recovery, never another blind create. A known returned ID is bound even if
desired state changed. Only an adapter-confirmed unsent quota/pause/cancellation deferral
clears the intent. Invisible, duplicate or full recovery inventory retains inspectable
bounded work. This favors duplicate prevention over automatically recreating an entity
whose initial attempt may never have reached Brevo.

Successful Company GET stores `company_read`, containing only parsed owned fields and
explicit linked IDs. A deferred PATCH resumes from that record and omits unchanged fields.
The handler rechecks source before writes and after HTTP, clears read progress after a
successful write, and schedules changed desired state. Link work requires both safe parent
mappings; mapped-but-blocked parents cannot authorize links. Association mappings retain
both remote endpoint IDs before HTTP, including partial/ambiguous success. Unlink still
works when a parent is blocked, and an absent remote Company is already unlinked.
Removed pairs can reserve/refund retry allowances despite their deletion marker.
An unchanged pair blocked only by `prerequisite_blocked` reassesses current parents on
its next execution, so recovered parents can authorize progress without resetting the
pair's revision or retry allowance. Pair identity/provider blocks remain inspectable.

The reserved pool still has at most four connections. One session connection holds
endpoint locks while other connections perform short source/storage operations. Losing
the lock connection aborts the outbound request and destroys that connection; work remains
recoverable/inspectable. Brevo has no fencing token. A previously sent request can still
be accepted after a connection loss, and no atomic remote ordering guarantee is claimed
for that failure window. Source deletion can likewise race the final pre-request check.
Terminal entity tombstones remain authoritative and remote IDs stay available for cleanup.

## Deletion and bounded orphan checks

Deletion facts enter the existing User/Organization commands. Cleanup runs under the
same endpoint advisory locks as upserts and associations, with the same revision-scoped
retry allowance, quota refunds, durable continuations and native Graphile fallback.
It retains identity-only tombstones, remote bindings and Company create intent after
success. Parent deletion fans out retained pairs after cleanup; an absent endpoint
makes pair removal successful without modifying another Company or Contact.

Contact cleanup looks up the exact deployment-scoped `ext_id`, checks any retained
remote ID, then deletes only that verified Contact. Company cleanup verifies the
exact `everr_org_id` and remote ID. An attempted but unbound Company create uses
bounded inventory recovery; invisible, duplicate or full inventories never authorize
another POST or an assumption of absence. Identity mismatches stay blocked for
inspection. A 404 from a mapped lookup or DELETE is successful cleanup. Email and
domain never select a cleanup target, so a new User with the same email remains a
distinct external identity. No source operation waits for CRM execution.

`cleanup_company_read` persists a separate ownership read for Company deletion and
pair unlink across the general 36-second permit gap. An ordinary upsert read cannot
authorize cleanup, and a changed desired revision clears cleanup progress. Unlink
also verifies the Contact's exact identity and removes only the retained pair.
Brevo offers no conditional ownership write or fencing token. Ownership changes
made remotely after the verified read, or late acceptance after lock-session loss,
cannot be fenced atomically. The cached read can survive deferred attempts; cleanup
assumes these external identity attributes remain stable during that phase. An
externally renamed/missing mapping is never reset or recreated automatically.

Bootstrap and periodic reconciliation scan retained projections in their
`projection` phase, including cascaded pairs and completed tombstones. The same
checkpointed admission path queues normal coordinated jobs; handlers reread current
source state before saving desired state. There is no separate orphan scanner.
A completed tombstone carries its observed revision so only that exact revision
can open one new cleanup revision. Duplicate or older repair commands cannot reset
pending, blocked or exhausted allowances. These checks also repair remote creates
accepted after an earlier cleanup observed 404.

## Telemetry

The existing application OTel provider exports `crm.user.sync`, `crm.organization.sync`
and `crm.membership.sync` logs,
`everr.crm.sync.outcomes` (unit `1`) and `everr.crm.sync.lag` (unit `s`). Only bounded
outcome and entity-kind dimensions appear on metrics. Event, User and job IDs
appear on logs, never emails, names, payloads, secrets or raw database/provider
errors. `everr.crm.failures` reports the known database count after reservation,
refund or revision refresh; it is omitted when that count is unknown. Legacy
command counters never supply diagnostic state. The existing publisher emits enqueue failure exceptions and counters.

For isolated local verification, set `OTEL_EXPORTER_OTLP_ENDPOINT` to the collector
URL returned by `everr local status`. For a selected remote installation, set
`EVERR_INGEST_ENDPOINT` to its ingest URL and `EVERR_INGEST_KEY` to its server ingest
key, leave the unauthenticated `OTEL_EXPORTER_OTLP_ENDPOINT` override unset, restart
the app, then query its logs/metrics with `everr cloud query`. CRM activation separately requires validated `CRM_BREVO_MODE`,
`CRM_BREVO_API_KEY`, `CRM_BREVO_DEPLOYMENT` and `CRM_BREVO_ACCOUNT_SCOPE`, plus prepared
schema/provider fields. Follow the operations runbook before enabling a target deployment;
local verification does not prove production ingestion.

## Verification

`projection.test.ts` exercises readers and store behavior with disposable PGlite:
identity separation, Plan/access/readiness, stable snapshots, source deletion,
Membership re-addition, retained mappings and revision guards.
`user-sync.integration.test.ts` and `related-sync.integration.test.ts` exercise
PostgreSQL/Graphile admission, source races, endpoint coordination, durable retry
budgets, deletion, resumable bootstrap and reconciliation. Real PostgreSQL cases
require `EVERR_IDENTITY_TEST_DATABASE_URL` pointing to a disposable database.
Run database suites sequentially against separate empty databases because their
fixtures create and remove the same table names. Provider transport in these
suites is controlled; passing them does not validate a real Brevo account.

Task-list and worker lifecycle tests cover registration, capacity, pause, startup
rollback and shutdown. For real provider validation, use only owned disposable
fixtures and the field/readback gates in the operations runbook. Verify diagnostic
ingestion in the intended Everr installation after exercising the matching build.

## Resumable bootstrap

The cloud command `pnpm --filter @everr/app-cloud crm:bootstrap --page-size 100 --max-pages 10`
admits existing source state without making provider calls. Both bounds are
required: a page has 1 through 100 rows and an invocation has 1 through 1,000 pages,
including empty pages that advance phases. Memory stays bounded to one page.
Prepare the cloud schema from source before use; this increment generates and
applies no application migrations. Graphile must already have its worker schema.

Supply `DATABASE_URL` and the runner's validated `CRM_BREVO_MODE`,
`CRM_BREVO_DEPLOYMENT`, `CRM_BREVO_ACCOUNT_SCOPE` and `CRM_BREVO_API_KEY` through
the process environment. The command uses only the database and never sends the
key. Its account scope is stable across API-key rotation. Use the same database,
deployment namespace and account scope as the integration runner. One logical
installation and namespace is supported per Graphile database; replicas share it.
The checkpoint scope does not route jobs between installations. Stage and
production use separate databases/namespaces and appropriately isolated CRM
accounts/budgets. Production integration remains disabled until rollout gates pass.

`bootstrapCrm` is the reusable cloud primitive for later reconciliation. It scans
Users, Organizations, explicit Membership rows (coalesced by User/Organization
pair), then retained projection identities. Each uses primary-key keyset order.
The last pass admits both live and missing mappings, retaining deletion safeguards,
including exact completed-tombstone revision rechecks. No desired state or remote
mapping is overwritten during pagination. The usual coordinated handlers reread
current profiles, Memberships, billing and already stored milestones. Missing
activation history remains null. No User-created/deleted business fact, welcome
event, list/campaign enrollment or historical activation is invented.

`crm_bootstrap` holds one current scan per deployment/account, with a scan ID,
phase, cursor and cumulative admission/page counts. The short transaction uses a
PostgreSQL advisory transaction lock and commits its page's public Graphile
`add_job` admissions and checkpoint together. A NULL receipt or error rolls both
back. No source transaction survives an HTTP operation. Concurrent invocations can
advance separate pages safely; overlap returns an error and preserves progress.
This is an administrative job-admission transaction, separate from the
direct Graphile domain publisher. It is not a business-event outbox.

The command uses PoolClient's public Graphile SQL directly, rather than the app's
Drizzle wrapper, to avoid importing an application database singleton and unrelated
environment validation. Both use the same payload/spec definitions, stable job
keys, `preserve_run_at` coalescing, fixed queue partitions and NULL-receipt guard.
The provider runs only through normal workers, sharing live endpoint budgets and
preserving durable failure allowances, blocked work and ambiguous Company-create
intent. Replacing a pending bootstrap payload cannot replenish those allowances.

Repeating the command resumes committed progress. Completed scans return unchanged
unless `--new-scan` explicitly starts another full pass; that option rejects an
unfinished scan. SIGINT/SIGTERM stops after committed work and rolls back a partial
page. The command reports `admissionCompleted`, phase and cursor; its
`remoteConverged: false` means provider convergence was not measured. Check worker
lag, pending/blocked/exhausted jobs and projection outcomes separately. Paused mode
can complete admission while retaining all work for a later configured runner.
Disabled mode exits unsuccessfully before creating a checkpoint or jobs.

A scan is not a globally consistent source snapshot. Live updates/deletions before
execution are resolved by authoritative worker reads. Concurrent inserts behind a
completed cursor, or updates after successful worker execution whose notification
was lost, require an explicit subsequent scan or periodic reconciliation. Bootstrap
does not schedule later scans itself. Counts describe admissions, including
coalesced duplicates and retained mappings, rather than unique provider writes.

The PostgreSQL/Graphile suite covers bounded pages, resume/repeat, atomic rollback,
NULL receipts, cancellation, concurrent commands, inserts behind cursors, live
source changes, durable quota deferral and unchanged blocked/exhausted allowances.
Existing sync diagnostics apply to admitted work.

The CLI deliberately emits one fixed failure message without raw database errors
or configuration values. On failure, check the required bounds and `--new-scan`
rule first, then mode and the four CRM configuration values, `DATABASE_URL`
connectivity, prepared `crm_bootstrap`/`crm_projection` tables, and the public
`graphile_worker.add_job` function/permissions. An overlapping page may be retried.
Inspect `crm_bootstrap` phase/cursor/counts in that database to find committed
progress; a failed partial page has no checkpoint advance or durable admissions.
Do not reset blocked projections, Company-create intent or retry counters to make
a bootstrap appear complete. Operational errors require inspection and a rerun
from committed progress. The runtime is the package's `tsx` script, not direct
Node execution of extensionless TypeScript imports.

## Periodic current-state reconciliation

Configured cloud runners schedule `crm/reconcile` through Graphile's public cron
interface once per minute, priority 100, without cron backfill. Each execution
admits at most 10 rows in one short transaction. `crm_reconciliation` has a
separate deployment/account checkpoint with scan ID, phase, keyset cursor and
committed admission/page counts. It reuses the bootstrap source/retained-identity
passes and atomic admission/checkpoint primitive. Interrupted pages roll back;
replicas serialize pages with a transaction advisory lock. No source transaction
or worker slot waits for a parent task or long provider permit.

An unfinished cycle resumes. A completed admission cycle waits 24 hours before
starting again. It is not a global source snapshot: a later cycle covers inserts
behind earlier cursors. Completion describes admission only, never measured remote
convergence. At 100 active CRM sync jobs, the scanner defers without advancing its
checkpoint. Permanently failed jobs are excluded from this admission cap, while
remaining inspectable. A page can cross the threshold by at most 10 admissions;
normal parent fanout may add further jobs. Live work has the usual priority 0;
periodic coalesced sync jobs keep that same priority so replacing a live payload
cannot lower its priority. Existing active keyed work is left alone. Retained
terminal jobs can be admitted again so the worker observes a newer source change
whose notification was lost. An unchanged snapshot retains its block or exhausted
allowance and makes no provider request. The scanner itself
runs below live jobs, and bounded admission plus the cap limits repair pressure.
Live work and repair share endpoint locks and the persisted account request budgets.

Paused mode selects live event-to-job routes and retains queued work, but starts no
outbound runner or periodic scan. The periodic primitive also explicitly defers
paused work before creating progress. Disabled mode selects neither routes
nor runner, and refuses administrative admission. Self-hosted imports none of the
CRM configuration, runners or schema. No production setting was enabled here.

Source passes queue latest-state reads for missed User, Organization, Membership,
Plan and stored milestone changes. The retained pass also covers deleted sources,
cascaded pairs and completed tombstones, including late accepted creates. These
are detection/check commands, never invented User lifecycle or activation facts.
Unknown activation history remains null.

Completed live mappings receive `verifyRemoteRevision`, the completed revision
observed by the scanner. Under normal endpoint locks, only that exact completed
revision can open one fresh check. A persisted `remote_check_id` marks the cycle,
including successful source-phase sync, and parent fanout preserves pair checks.
The retained phase therefore cannot reopen a snapshot already checked in this
cycle. Duplicate commands cannot replenish pending, blocked or exhausted work.
Company intent and bindings remain intact. Each new cycle can make fresh provider
reads; local snapshots alone never prove remote correctness.

Fresh Contact/Company reads verify exact external identity and apply only changed
owned fields. Pair checks verify the exact owned Company and its explicit linked
Contact IDs, skipping the write when the requested association already matches.
Deferred Company/pair writes retain their owned read across the general permit
gap; a fresh check revision clears that cache. Changes during provider work are
resolved by authoritative rereads and another persisted execution. Provider
ownership changes after a verified read remain subject to the provider's existing
lack of conditional writes/fencing.

Mapped missing Contacts/Companies are detected as `mapped_contact_missing` or
`mapped_company_missing`, blocked and logged without another create. This increment
does not implement remote mapping replacement. Inspect the exact deployment-scoped
external identity, retained remote ID, all pair endpoint mappings, source state and
Company-create intent. Recovery of a truly removed remote entity requires a
separate reviewed mapping-replacement procedure with fresh exact ownership/absence
verification and consistent pair mapping changes under endpoint locks. There is no
supported command here to clear bindings or re-POST Companies. An ordinary retry
cannot replace an immutable binding, and must not be presented as missing-record
auto-repair. Other identity conflicts remain blocked for inspection.

### Explicit exhausted-work recovery

After inspecting an exhausted projection and resolving its cause, use
`pnpm --filter @everr/app-cloud crm:recover --kind user --source-id <id> --expected-revision <revision>`.
Kinds are `user`, `organization` and `membership`; a Membership source ID is the
JSON User/Organization pair stored in `crm_projection.source_id`. Use the same
process configuration and database as bootstrap. No provider request occurs in
this command. It admits an ID-only `crm.recovery.requested` job and reports
`recovered: false`, because execution has not yet happened. Paused mode admits the
command; disabled mode rejects it. Invalid/stale admission preconditions fail with
a fixed sanitized diagnostic.

The coordinated worker checks the expected desired revision and exhausted count
again under endpoint locks. Only a matching unsynchronized revision with at least
eight failures opens one new allowance. Bindings, Company-create intent and known
pending start remain intact. An ambiguous Company create resumes bounded inventory
recovery, never a blind second POST. A duplicate/old recovery request cannot reset
a newer allowance and still processes newer current pending state, so coalescing
cannot discard valid live work. This command does not recover ordinary identity
blocks or replace mapped missing records.

### Reconciliation telemetry

The existing application OTel pipeline now exports `crm.reconciliation` logs and
`everr.crm.reconciliation.outcomes` (counter, unit `1`) with bounded outcomes:
`progress`, `deferred`, `failure`, `drift`, `missing`. Drift records successful
owned-field/association corrections, including ordinary sync corrections; it is
not a distinct-entity count or an atomic external receipt. Missing-record and
scanner-failure logs have error severity. Progress includes committed page and
admission counts. IDs, profile data, payloads, SQL and provider errors are absent
from these new signals; only bounded outcome/entity-kind metric dimensions exist.

`everr.crm.sync.oldest_known_pending` (gauge, unit `s`) reports the oldest known
pending observation across unsynchronized projection `pending_since` values and
active sync jobs' `created_at` from Graphile's public jobs view. The minimum is
safe when a job also has a projection. Retrying does not move a projection's
pending start; success clears it, and later detected work establishes a new start.
A queued job is covered before its projection exists. Legacy NULL projection
starts remain unknown; job creation and first detection are lower bounds, not
fabricated historical publication times. Zero means no known pending timestamp.
This gauge is not the total historical age of every lost event or backlog item.
It is sampled by configured periodic executions, including backlog deferral.
Paused runners emit no periodic samples. Existing local/remote exporter activation
instructions above apply unchanged; production ingestion remains unverified.
