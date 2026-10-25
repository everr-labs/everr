# Brevo CRM integration through business events

Status: tasks 00 through 14 are implemented, independently reviewed and committed.
Task 14 is committed as `54c768cac`. Task 15's disabled-default deployment
configuration is independently reviewed and committed as `1df983b` in
`everr-deploy`; target rollout remains pending. Task 16's optional campaign
specification is independently reviewed and included with this specification
commit, outside this rollout.
The [execution ledger](../todo/issues/brevo-crm/README.md) preserves individual
commit identities and verification history.

The [CRM operations runbook](crm-operations.md) is the current configuration,
schema, provider-field/readback gate, bootstrap, diagnosis and rollout contract.
The [background-work document](background-work.md) now describes implemented
ownership. This plan records the design and its intentional limits. Product
mutations remain authoritative if ancillary publication or consumer enqueue fails.

## Implemented foundation

- [Background work](background-work.md) already separates domain facts from worker
  commands and documents transactional enqueue and at-least-once execution.
- The product runner owns alerting, GitHub tasks, and preview retention. Cloud
  registers its reserved organization provisioning runner and independent CRM
  runner through `ApplicationRuntime.registerWorkers()`.
- The existing standalone `addWorkerJob(...)` path can persist consumer jobs
  independently of a source mutation. Reuse Graphile for durable execution after
  best-effort enqueue, without a new generic event outbox or dispatcher table.
- Organization creation/deletion already persists lifecycle commands in the
  Better Auth persistence adapter. Billing applies conditional subscription
  updates inside transactions. The bounded typed publisher fans out best effort after the source commit.

## Architecture

```text
Feature mutation
                  |
          source commit succeeds
                  |
       events.publish(event): void ----> main execution continues
                  |
     background subscriber fan-out
                  |
      composition-selected subscribers
                  |
     independent best-effort enqueue
                  |
       one durable command per subscriber
                  |
      cloud integration runner (Graphile)
                  |
        Brevo projection handler
                  |
             Brevo REST API
```

The shared product owns the meaning of identity, Organization, and Membership
facts. Cloud owns billing facts and its CRM handlers. A business event describes
what happened; a subscriber decides which work that fact requires.

Keep the domain-facing interface small: `events.publish(event): void`. Call it
after the source mutation has committed. It starts background fan-out and returns
without waiting for job persistence or external delivery. No transaction handle,
operation-scoped recorder, subscriber registry, or provider client appears in
the interface used by the producer. Source operations use their existing
transactions and persistence modules without a new UnitOfWork abstraction.

An illustrative application interface is:

```ts
const user = await createUser(input); // Resolves after the source commit.
events.publish({
  type: "identity.user.created",
  version: 1,
  subjectId: user.id,
  data: { userId: user.id },
});
return user;
```

The producer supplies a typed fact from already available source values; the
publisher constructs envelope metadata such as the event ID and occurrence time.
The publisher owns envelope construction/normalization and validation failures,
synchronous subscriber exceptions, rejected enqueue promises, and diagnostic
errors. They must never escape into the main operation or become unhandled
rejections. Keep payload construction simple and validated inside the publication
path; a throwing argument factory at the call site would otherwise bypass the
publisher's error handling. Do not catch failures from `createUser` as publication
failures: an unsuccessful source mutation must still fail normally.

Use a typed envelope with `id`, `type`, `version`, `occurredAt`, `subjectId`, and
feature-specific `data`. Actor identity is optional: background transitions have
no invented User. Payloads contain stable IDs and only facts needed by consumers,
not credentials or copies of complete database rows. Workers validate persisted
payloads, and schema upgrades must keep old readers or explicit upcasters.

Definitions live with their feature. Each static registration combines a feature
definition and typed consumers with stable subscriber IDs. The publisher derives
routing by type and version, validates each publication once, and copies the
validated payload for each consumer. Cloud composes shared and cloud-specific
registrations locally. Shared modules must never
import cloud types, a Brevo client, or deployment conditionals. Routing, validation,
or enqueue failure is reported in telemetry and cannot change the already committed
source result. Isolate subscribers so one failure does not prevent attempts to
enqueue work for the others.

The self-hosted composition supplies no CRM subscribers, so publication is a
no-op for these effects and creates no CRM jobs. Cloud supplies its Brevo
registrations at composition time. Neither publication nor registration depends
on a running worker or mutable process-global listeners. Adding a future consumer
requires a new registration, not edits to the producing feature.

## Delivery guarantees and accepted loss

There are two distinct reliability stages:

| Stage                                     | Guarantee                                 | Failure behavior                                                           |
| ----------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Source commit to consumer job persistence | Best effort, fire and forget              | Keep the source result successful; record publication failure in telemetry |
| Persisted Graphile job to Brevo           | At-least-once execution with retry budget | Retry transient errors; retain exhausted work for inspection and recovery  |

Events can be lost if enqueue fails or the process terminates between source
commit and job persistence. This is accepted behavior. A hard kill can also
prevent a diagnostic from being emitted; telemetry is not a durable event log.
There is no general event outbox, atomic fan-out, historical replay guarantee,
or automatic rollback of source state on publication failure.

The background publisher independently enqueues one command per matching consumer.
Some subscribers may persist work while others fail. Include stable event and
subscriber IDs in job metadata and diagnostics, and preserve payload readers
while persisted jobs exist across deployments. Job keys can reduce duplicate
pending work but are not lifetime delivery receipts.

Track in-flight publication promises inside the publisher so all rejections have
handlers. On normal shutdown, attempt a bounded drain before stopping the workers
and flushing telemetry. Do not wait for this drain in the user request or promise
survival after a crash. Guard diagnostic failures to avoid recursive publication
or changing the source result. Bound background publication and report overload
instead of allowing unbounded memory growth or blocking the main operation.

On publication failure, emit an error log with the event type/ID, consumer ID,
failure stage, and exception, plus a failure counter. Counter dimensions include
only bounded event types, consumer names, and failure stages; entity/event IDs
belong on logs and traces. Use OTel semantic conventions and `everr.*` for custom
attributes. Diagnostic export is itself best effort and never throws to the caller.

Bootstrap and reconciliation repair the CRM projection from current authoritative
state, including Users whose creation events were lost. They cannot reconstruct
every missed historical transition. Deletion requires cloud mapping/tombstone
reconciliation as well: source records may no longer exist when publication is
lost. Periodically compare Everr-owned remote mappings against current local IDs,
and remove stale remote records/associations without touching unrelated contacts.

## Event ownership and publication sites

Names below are proposed domain contracts. Provider-specific names are mapped
inside adapters and need not match these strings.

| Facts                                                                                                | Owner                                      | Authoritative transition, publish after commit                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `identity.user.created`, `identity.user.updated`, `identity.email.verified`, `identity.user.deleted` | Shared identity                            | Persistence mutation, including OAuth and verification-token paths                     |
| `organization.created`, `organization.updated`, `organization.deleted`                               | Shared Organization lifecycle              | Actual insert/update/delete, not session or page callbacks                             |
| `membership.added`, `membership.updated`, `membership.removed`                                       | Shared Membership lifecycle                | Mutation including invitation acceptance, leave, direct removal, and cascades          |
| `organization.provisioned`                                                                           | Shared readiness meaning, cloud transition | Guarded pending-to-ready update only when a row transitions                            |
| `billing.subscription.changed`                                                                       | Cloud billing                              | Accepted provider revision, published after the `saveSubscription` transaction commits |
| `organization.plan.changed`                                                                          | Cloud Plan policy                          | Effective Plan change, including downgrade commands                                    |
| `telemetry.first_queryable`, `organization.activated`                                                | Product milestone meaning, cloud detection | Durable milestone transition based on verified customer-data observations              |

Audit every mutation path before adding hooks. Use a verified post-commit hook
or the application operation's successful completion. For Better Auth, establish
which hooks run after the outermost transaction actually commits. A persistence
adapter callback that returns inside an open outer transaction is not yet a
committed source transition. Shared identity accepts a typed publisher dependency;
hooks publish facts without making Brevo requests or awaiting CRM persistence.
Capture before/after state under the appropriate lock to avoid duplicate or
false verification transitions. A User initially created verified is represented
correctly in its creation fact; repeated verified updates are not new milestones.

Direct Drizzle operations also require coverage. In particular,
`restrictOrganizationToOwner` removes Memberships during a downgrade, bypassing
ordinary auth hooks. Parent deletion must retain enough IDs to repair remote
associations and remove the remote record without needing deleted source rows.
Use a documented parent-deletion cleanup contract rather than emitting fabricated
child facts after cascades.

Keep existing provisioning jobs and billing authorization/provider verification
on their current paths. CRM is an ancillary consumer. Duplicate or older Polar
webhooks do not produce a new event when the conditional update accepts no row.
Publish readiness only after the guarded update commits and returns a transitioned
row. Publish accepted subscription, Plan, and Membership changes after their
existing transactions resolve successfully. No source operation waits for CRM
consumer enqueue or rolls back because it failed. Existing provisioning and
other critical transactional commands keep their current guarantees.

## CRM projection and data ownership

Everr's database remains authoritative for product identity, Memberships, Plan,
subscription state, and milestones. Brevo owns CRM notes and communication
preferences. Sync only the fields owned by Everr.

| Everr entity | Brevo entity                | Identity and synchronized fields                                                                                  |
| ------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| User         | Contact                     | Deployment-scoped `ext_id`, name, email, original registration date, verified status                              |
| Organization | Company                     | `EVERR_ORG_ID`, name, creation date, Plan, app access state, subscription state, provisioning and milestone dates |
| Membership   | Contact/company association | Current membership, linked explicitly by IDs                                                                      |

Plan, subscription status, and effective app access state remain separate. A Pro
Organization can be suspended; a scheduled cancellation is not an immediate
downgrade. One User can belong to several Organizations. Do not copy one
Organization's Plan onto a User or associate Organizations by email domain.

Add cloud-owned synchronization state for remote IDs, desired/synchronized
revision or snapshot fingerprint, status, last success/error, and deletion
tombstones. It must survive deletion of source rows until remote cleanup has
completed. Namespace IDs or isolate CRM accounts by deployment so development
cannot overwrite real customer records. Do not generate migrations automatically.

A CRM handler synchronizes the latest authoritative snapshot, rather than
replaying old email/Plan values from each triggering event. Serialize overlapping
updates of the same remote entity, including across app replicas, to prevent
older in-flight writes finishing after newer ones. Use fixed queue partitions
or explicit coordination, not an unbounded new queue per event. Ensure required
contacts/companies exist before linking, and reconcile removed associations as
well as additions. Handle concurrent deletion and prevent stale jobs recreating
deleted contacts or companies.

Brevo Contacts accept an external ID. Companies use a Brevo-generated ID, so
persist its mapping and an Everr-ID attribute. Test recovery after an ambiguous
company-create response before promising duplicate-free creation: a local unique
constraint cannot make a remote POST exactly once. Confirm lookup by custom
attribute with the real API; otherwise use a bounded inventory/recovery workflow.
Never blindly repeat an uncertain company creation.

## Projection delivery versus historical event delivery

The first release synchronizes entities and milestone attributes. It does not
export every internal event to Brevo's Events API.

If lifecycle campaigns later need historical events, add a separate subscriber
with the original event ID, occurrence time, subject, and immutable facts. A
failed event export must not repeat a completed profile sync, and vice versa.
Do not merge distinct historical events under one replaceable job key.

Once a job is persisted, execution and external delivery attempts are at least
once. Initial publication remains best effort. Graphile job keys deduplicate
pending work, not effects already accepted remotely. A local delivery receipt
reduces repeated sends but cannot close the crash window between remote success
and receipt persistence. Brevo's documented Events API does not establish a
general event-id idempotency guarantee. Do not promise exactly-once email
automation triggers from it; test and design suppression/recovery first.

The optional [campaign delivery design](crm-campaign-delivery-design.md) specifies
retained-fact limits, actor-preserving recipient selection, separate delivery
receipts, conservative unknown-outcome recovery and the missing remote verification.
It adds no runtime exporter or automation. Its scenario table is a design review,
not proof of live duplicate suppression or automation entry behavior.

## Activation, confirmed definition

An Activated organization is a Cloud Organization whose own telemetry is
queryable and has been usefully consulted for the first time by a Member or an
authorized client in that same Organization, as defined in [the glossary](../CONTEXT.md).
Provisioning, first queryable data, activation, current activity, and billing are
independent milestones or states. Activation stays achieved if usage later stops.

Implement a once-per-Organization transition with a rule version and observation
time. A useful consultation must be a completed supported product action on
the Organization's own Production or CI telemetry. Candidate actions are opening
a trace, log, error, or CI run detail; rendering a dashboard with own data; and
an interactive CLI or MCP query on own data. A nonempty result alone does not
prove a useful action. Exclude `SELECT 1`, probes, TestData, synthetic/demo data,
Everr's internal telemetry, empty dashboards, unattended polling, automatic
backfill, and redundant panel refreshes. The first dashboard consultation counts
once, not once per panel. An empty query result alone does not prove own data is
queryable and cannot establish initial activation.

The current implementation supports only the conservative trace-detail paths
documented below, with server completion evidence. The broader candidate actions
are future coverage, not current guarantees. Surface, authenticated scope, and evidence must be
established server-side. A successful useful consultation can establish
queryability and activation together; there is no need to scan all tenants on
every ingestion. These rules are self-contained and do not depend on unrelated
research drafts being committed.

The usage metric measures durable exporter admission, not confirmed storage or
consultation. Do not derive activation from a positive usage counter or from the
customer telemetry Timestamp, which may refer to old imported data. If a separate
first-queryable detector is added, define its evidence and reconciliation across
ClickHouse and Postgres explicitly. Persist the verified observation and marker,
then publish the milestone best effort after its commit. A failure to persist an
ancillary observation/marker is measured in telemetry and must not turn an
otherwise successful consultation into a failed query. Reconciliation projects
stored milestones even when their event was lost. Where observation itself was
lost, later use may establish the milestone but cannot prove the earlier first
value time. Record observation coverage and never invent historical first-value
times for existing Organizations.

Task 10 implements the [server observation contract and cloud marker capability](../packages/cloud/src/organizations/README.md).
Rule 1 atomically establishes both markers once from a valid useful consultation.
Observation time is stamped by the server at admission after action completion;
`observer_started_at` records the winning process capability start, not historical
coverage. The capability remains available with CRM disabled or paused. There
were no live completion hooks in task 10. Task 11 adds the conservative
trace-detail coverage documented in the capability README; dashboard rendering
and generic query coverage remain unsupported. Current Company
snapshots read markers even after lost fact publication; missing markers remain
unknown. Authorization is verified at the completed action, so later Membership
departure does not invalidate it. Organization clients can have an authorized
query grant without an invented User. The observer admits at most 32 in-flight
operations, drains for at most 3 seconds before publication shutdown, and measures
validation, overload, clock, storage, publication and lifecycle failures without
changing the successful action. Source schema changes have no generated or
applied application migrations. Isolated PostgreSQL tests, fresh Everr log/counter
queries and the three required Company text-field creation/readback checks passed;
independent task 10 review found no material standards or spec defects, with
116 focused regression cases and both package TypeScript checks passing independently.

Brevo events are contact-oriented. An Organization milestone must not invent a
User or imply every Member performed it. Initially synchronize milestone fields
on the company. Any later recipient projection needs an explicit policy, such as
current Owners, and preserves the Organization ID and actual actor when known.

## Cloud runtime and failure handling

Register a cloud integration runner through `ApplicationRuntime.registerWorkers`
alongside the existing organization runner. Keep CRM traffic out of the reserved
provisioning capacity and the product alerting runner. Start with one integration
execution slot in the same app process; tune only from observed lag and quotas.
Reuse the existing supervisor, startup rollback, HMR lifecycle, and shutdown.
The publisher attempts background enqueue after committed facts; the cloud
integration runner owns outbound CRM execution. No shared outbox dispatcher or
additional product-runner task is required.

Each handler has bounded HTTP timeouts, cancellation where supported, and
persisted retry/backoff. Retry network/429/5xx failures; honor provider rate-limit
reset information. Treat invalid schema/credentials as inspectable blocked work,
not an endless fast retry. Preserve exhausted work and admit guarded expected-revision recovery only for
exhausted allowances. Ordinary permanent blocks and mapping replacement have no
supported reset command; Graphile replay alone does not bypass durable guards.
Never hold a domain transaction open while calling Brevo.

Enforce request budgets per endpoint group, including across replicas. Brevo's
published general limits allow 100 requests/hour for otherwise unspecified
endpoints, relevant to company operations. Avoid writing unchanged snapshots;
backfill and reconciliation consume the same budget as live sync. Fixed worker
concurrency alone is not a rate limiter.

An enabled integration must pass configuration validation and the runbook
schema, field-inventory and exact-record readback gates. Support a pause mode
that preserves pending work; do not make missing credentials silently consume
jobs. Cloud without configured CRM remains usable, with an explicit disabled
mode and later bootstrap. A temporary pause preserves the integration's persisted
jobs rather than treating them as successfully handled. Self-hosted needs no
Brevo configuration, event outbox, CRM synchronization tables, or handler imports.

Preserve opt-outs and consent across bootstrap, sync, and email changes. Brevo
documents that changing a blocklisted contact's email can remove its blocklist;
the adapter must prevent unintended resubscription. Initial import emits no
historical or welcome events and does not explicitly enroll Contacts. Before
target import, audit account automations because profile creation/updates may
match independent provider entry filters. The campaign design records the gate
and its official provider sources; omitting Events API calls alone is insufficient.

## Implementation sequence and acceptance

The implementation is split into [individual commit-sized tasks](../todo/issues/brevo-crm/README.md).
Each ticket specifies prerequisites, suggested English commit message, repository,
scope, acceptance criteria and evidence. The task index records implementation,
independent review and coordinator commit separately. Task 13's final independent
review passed 145 behavior checks and fixed retained-terminal repair admission;
its coordinator commit is `f23e32eeb`. Task 14 is committed as `54c768cac` and task
15's separate reviewed configuration as `1df983b`. Production remains disabled
until target-specific schema/canary proof, durable settings, CI adoption and
explicit authorized rollout. Task 14's isolated proof is not target-account proof.

| Increment                            | Tickets            | Result                                                                                                            |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Planning baseline                    | 00                 | Commit the agreed design, glossary definition, and task breakdown                                                 |
| Publisher and business facts         | 01, 02, 03, 04     | Fire-and-forget publisher plus User, Organization, Membership, billing, Plan, and readiness events                |
| Cloud CRM projection                 | 05, 06, 07, 08, 09 | Synchronization state, provider adapter, isolated runner, contacts, companies, associations, and deletion cleanup |
| Verified activation                  | 10, 11             | Durable milestones from useful UI/CLI/MCP consultations, synchronized to companies                                |
| Import and repair                    | 12, 13             | Resumable bootstrap and periodic repair after lost notifications                                                  |
| Operational readiness and deployment | 14, 15             | Verified runbook and a separate infrastructure commit in everr-deploy                                             |
| Optional campaign design             | 16                 | A later delivery/recipient specification, without enabling campaigns                                              |

Task 07 is the first complete event-to-CRM slice. Feature code remains disabled
by default until the production prerequisites are satisfied. Each commit builds
and includes meaningful behavioral checks against its prerequisites; tests are
not deferred wholesale to the final operational task. The infrastructure ticket
is committed in its own repository. Neither these tickets nor their commits apply
migrations or activate production automatically. Do not generate migrations
automatically, and keep existing SMTP authentication email delivery unchanged.

Manual app checks use the main-worktree `.auth` credentials when available.
Telemetry added during implementation follows OTel semantic conventions and
`everr.*` custom attributes, and is verified through Everr ingestion. Log event,
consumer, entity and job IDs without contact payloads or secrets. Observe
publication/enqueue failures, in-flight publication, overload drops, job lag,
exhausted jobs, synchronization failures, reconciliation drift, and oldest
unsynchronized entity. Add a behavioral check that forces enqueue failure,
confirms the User is still created, and verifies the diagnostic arrives in Everr.

## Module locations

- `packages/app/src/identity/events.ts` and feature equivalents: event schemas.
- `packages/app/src/server/business-events/`: typed best-effort publisher,
  background fan-out, failure diagnostics, and bounded lifecycle handling.
- `packages/app/src/composition/`: type-only publication/subscriber contracts where needed.
- Both `src/app/composition/` implementations: explicit subscriber composition.
- `packages/cloud/src/billing/events.ts`: cloud billing/Plan facts.
- `packages/cloud/src/crm/`: desired projection, Brevo adapter, synchronization
  state, subscribers, tasks, reconciliation, and runner.
- Shared query capability completion paths plus cloud milestone persistence:
  verified activation observations without UI-only or provider-only assumptions.

Reuse existing schema/composition conventions rather than moving unrelated task
owners. Update `docs/background-work.md` and feature docs as each increment lands.

## External contract references

The rate-limit, contact-update, company-create/list, and Graphile job-key pages
were rechecked on October 23, 2026. Task 06 verified isolated contact email
suppression, stable identifiers, bounded company recovery and explicit associations.
The provider ignored the attempted company custom-attribute filter and returned
204 for company PATCH; the [adapter contract](../packages/cloud/src/crm/brevo/README.md)
records the verified behavior and recovery limits. Its isolated-account proof does
not establish unrestricted duplicate-free creation or phone-based SMS suppression.

- [Graphile transactional SQL enqueue](https://worker.graphile.org/docs/sql-add-job).
- [Graphile job-key caveats](https://worker.graphile.org/docs/job-key).
- [Brevo contact creation](https://developers.brevo.com/reference/create-contact).
- [Brevo contact updates and blocklist behavior](https://developers.brevo.com/reference/update-contact).
- [Brevo company creation](https://developers.brevo.com/reference/create-a-company)
  and [company lookup](https://developers.brevo.com/reference/get-all-companies).
- [Brevo Events API](https://developers.brevo.com/reference/create-event).
- [Brevo rate limits](https://developers.brevo.com/docs/api-limits).
