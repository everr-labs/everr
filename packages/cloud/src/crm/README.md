# Cloud CRM projection state

This module stores desired CRM state and includes cloud-only User, Organization and
Membership consumers, an independent integration runner and the [Brevo adapter and request budgets](brevo/README.md).
The integration is disabled by default and makes no startup provider calls. Cloud's schema entry point exports
`crmProjection`; the shared and self-hosted schema/composition do not import it.
Only schema source changes are included, with no generated migration artifacts.

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
opt-outs during email changes. A fingerprint describes the Everr-owned snapshot,
not the entire remote record, and cannot prove the CRM has not drifted.

Plan, subscription status and effective app access are distinct. The snapshot
reader calls the same `readOrgEntitlement` policy as the app, with the snapshot's
transaction executor, including catalog validation. An active Pro subscription
scheduled to cancel still grants Pro access. Past-due Pro remains Plan Pro with
suspended access. Provisioning uses the existing readiness policy, including its
legacy-ready behavior. Activation and first-queryable dates come only from the
cloud [verified milestone store](../organizations/README.md), in the same snapshot
transaction. Missing markers remain null (unknown history), never false or an
invented historical date. Readiness never implies activation. Both milestone
facts enqueue the existing latest-state Organization synchronization; Plan,
access, subscription and readiness field ownership remain independent.

## Reading and persisting

`createCrmSnapshotReader` accepts only source IDs, never event payload copies. User
and Organization reads use a read-only repeatable-read transaction so profile,
billing and Memberships share one committed view. Membership reads test whether
the pair currently exists. Missing sources produce identity-only deletion desired
state without retaining old contact fields. Membership arrays have stable ID order.

`createCrmProjectionStore` supports reading desired state, persisting a desired
snapshot, binding remote IDs, marking success/failure, and guarding retry allowances. Identical
fingerprints retain the revision and previous outcome outside an explicit completed
cleanup recheck. Changed desired state
increments the revision and becomes pending, retaining prior synchronized
fingerprint/revision and success time. Completion and failure updates require the
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

The store is a persistence seam, not outbound-write coordination. Tasks 07 and 08
must serialize each entity's load, desired-state update, provider work and outcome
across replicas, then reread current source state for subsequent work. Revision
guards protect local acknowledgements, but cannot prevent an old in-flight HTTP
request finishing after a new one. Association consumers must ensure both endpoint
mappings exist, reconcile additions and removals, and coordinate them with parent
deletion. No source transaction is held open during provider calls.

## User synchronization and execution

Cloud registers consumers for User creation, updates, deletion and email verification in
`configured` and `paused` modes. Each consumer independently persists an ID-only
`crm/sync-user` command after best-effort publication. Disabled mode registers no
consumers or integration runner; self-hosted imports none of this module. Paused
mode keeps admitting commands but starts no CRM consumer, preserving pending jobs.
Missing enabled configuration fails validation rather than consuming work.

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

Known transient/ambiguous failures persist a successor with an incremented failure
count and exponential backoff (up to one hour), honoring any later adapter `retryAt`.
Each desired revision has eight durable failure allowances. Before HTTP, the store
reserves one allowance with revision/count guards. Known quota/pause/cancellation
deferrals refund it before scheduling. Success and changed desired state reset the
count; continuation counts apply only to their recorded desired revision. A crash
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

## Organization and explicit Membership synchronization

Cloud also subscribes to Organization creation/updates, explicit Membership additions,
updates/removals, deletion, readiness, subscription and Plan facts. Commands contain source IDs only.
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

`enqueueCrmOrphans` checks at most 100 retained projections per keyset page against
current source IDs, including cascaded pairs. It returns the checked/admitted counts
and cursor for task 13, and queues normal coordinated jobs without changing source
rows or racing a worker's desired-state save. Callers persist a cursor only after
successful admission and repeat full scans to cover concurrent inserts. Completed
tombstones stay retained and are rechecked by the same bounded primitive, including
remote creates accepted after an earlier cleanup observed 404. Repair jobs use
`crm.reconciliation.requested`, a check ID and detection time, without fabricating a
historical deletion fact. The job carries the completed revision it observed; under
the endpoint lock, only that exact completed revision can open one new cleanup
revision. Duplicate or older repair commands cannot repeatedly reset the allowance.
Pending, blocked or exhausted cleanup never receives a fresh allowance from a check.
This increment adds no periodic scheduler or bootstrap.

Task 09 verification passed 33 related PostgreSQL/Graphile cases, 13 existing User
cases and 60 focused CRM cases. The isolated provider proof under
`.verify-everr/artifacts/task09-deletion-cleanup/` used the coordinated handlers to
create and delete one Contact and one Company, then verified remote 404 responses
and retained tombstones. Four general and five contact requests used the existing
shared budgets. All provider fixtures were removed. Existing diagnostics are reused
without new telemetry fields or metrics; production ingestion remains unverified.
`.auth` is absent, so authenticated manual app checks were skipped.

Independent task 09 standards/spec review found no material issues requiring code
changes. All 60 focused CRM tests, cloud TypeScript and scoped lint/format checks
passed independently. Review checked source changes after orphan paging, exact
completed-revision rechecks, retained blocked/exhausted allowances and destructive
ownership checks. Existing PostgreSQL/Graphile and provider evidence remains
applicable; review made no provider calls or telemetry changes.

## Telemetry

The existing application OTel provider exports `crm.user.sync`, `crm.organization.sync`
and `crm.membership.sync` logs,
`everr.crm.sync.outcomes` (unit `1`) and `everr.crm.sync.lag` (unit `s`). Only bounded
outcome and entity-kind dimensions appear on metrics. Event, User and job IDs
appear on logs, never emails, names, payloads, secrets or raw database/provider
errors. The existing publisher emits enqueue failure exceptions and counters.

For isolated local verification, set `OTEL_EXPORTER_OTLP_ENDPOINT` to the collector
URL returned by `everr local status`. For a selected remote installation, set
`EVERR_INGEST_ENDPOINT` to its ingest URL and `EVERR_INGEST_KEY` to its server ingest
key, leave the unauthenticated `OTEL_EXPORTER_OTLP_ENDPOINT` override unset, restart
the app, then query its logs/metrics with `everr cloud query`. CRM activation separately requires validated `CRM_BREVO_MODE`,
`CRM_BREVO_API_KEY`, `CRM_BREVO_DEPLOYMENT` and `CRM_BREVO_ACCOUNT_SCOPE`, plus prepared
schema/provider fields. Production activation remains gated by tasks 01 through 15;
this task changed no production configuration and generated/applied no migrations.

## Checks

`projection.test.ts` runs snapshot and storage behavior against disposable PGlite,
including the new schema source's columns, constraints and unique indexes. It
covers latest identity fields, deployment separation, several Organizations,
Plan/access/readiness distinctions, unknown billing products, deleted sources,
Membership re-addition, unchanged fingerprints, stale revisions, retained remote
IDs and outcome transitions. `user-sync.integration.test.ts` uses an explicitly
supplied disposable `EVERR_IDENTITY_TEST_DATABASE_URL` for real PostgreSQL/Graphile
job persistence, two-runner HTTP ordering, stale/deleted sources, auth success on
enqueue rejection, payload validation, quota/pause budgets, exhaustion and native
retry after failed successor insertion. Provider transport is controlled in these
worker tests; task 06's isolated-provider proof covers the actual contact contract.
Worker lifecycle tests cover separate capacity, pause, startup rollback and shutdown.

Task 07's isolated Everr proof created a real Better Auth User/account despite a
rejected cloud enqueue, then observed a persisted adapter 500 retry followed by
success after its full 60-second delay. Local evidence is under
`.verify-everr/artifacts/task07-user-sync/`; marker
`task07-b8bbf282-4344-4655-acd6-efe0028ff9c9` correlates the one enqueue exception
with the separate `-retry` job's retry/success logs. Counters and lag histogram
were queried from the same isolated collector. No real Brevo fixtures were needed
for this increment. `.auth` is absent, so authenticated manual app checks were
skipped; there is no UI change. Production ingestion remains unverified.

Task 08 adds 18 real PostgreSQL/Graphile checks for multi-company relationships, multiple
Owners, source changes, pair re-addition/removal, partial link failures, durable Company
intent/read phases, pause/quota refunds, bounded admission, two-runner parent coordination,
lock-session loss, native successor-insertion failure and accepted-create binding failure.
The actual isolated provider proof and new log/metric ingestion evidence are under
`.verify-everr/artifacts/task08-organization-sync/`. It linked one Contact to two Companies,
removed one pair, read both back, and deleted its two Companies plus one Contact. The proof
exposed eager fanout amplification; the final code coalesces admissions and delays fanout,
verified by the PostgreSQL bounded-job regression. Provider/telemetry evidence was preserved
without another provider run. Production activation/ingestion remain unverified; `.auth` is absent, so authenticated manual app checks were skipped.

Independent task 08 review fixed a derived dependency block that otherwise prevented an
unchanged pair from resuming after parent recovery. All 19 related PostgreSQL/Graphile
cases, 13 existing User integration cases and 59 focused CRM cases passed independently,
along with the cloud TypeScript check and scoped formatting/lint checks. The existing
provider and ingestion evidence remains applicable; review made no provider calls.

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
This is an administrative job-admission transaction, separate from the unchanged
fire-and-forget domain publisher. It is not a business-event outbox.

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
was lost, require an explicit subsequent scan or task 13 reconciliation. No
periodic scheduler is introduced here. Counts describe admissions, including
coalesced duplicates and retained mappings, rather than unique provider writes.

The PostgreSQL/Graphile suite covers bounded pages, resume/repeat, atomic rollback,
NULL receipts, cancellation, concurrent commands, inserts behind cursors, live
source changes, durable quota deferral and unchanged blocked/exhausted allowances.
No new telemetry fields or metrics are introduced; existing sync diagnostics apply.
`.auth` is absent and authenticated app checks are skipped.

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

Independent task 12 review added a final cancellation check before page commit,
covering signals received during the last admission or checkpoint query. All 46
related PostgreSQL/Graphile cases and 61 focused CRM cases passed independently,
alongside cloud TypeScript and scoped lint/format checks. Existing isolated-provider
proof remains applicable; review made no provider calls or telemetry changes.
