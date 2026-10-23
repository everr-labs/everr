# Cloud CRM projection state

This module stores desired CRM state. It does not register consumers, run a worker,
read Brevo configuration, or call a provider. Cloud's schema entry point exports
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

Contact external identity is intended for Brevo's `ext_id`. Company identity is
intended for the `EVERR_ORG_ID` attribute, alongside its persisted provider ID.
The adapter in task 06 owns provider request formatting and verification. Custom
product attributes use the `EVERR_` namespace; the desired snapshot uses the local
field names below. Source IDs are deployment scoped before leaving Everr.

| Projection   | Source-owned fields                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| User         | Name, email, original registration date, verified status                                                                         |
| Organization | Name, creation date, Plan, app access state, subscription status, current period end, scheduled cancellation, provisioning state |
| Membership   | Current explicit User/Organization association; snapshot membership IDs and roles describe authoritative membership state        |

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
legacy-ready behavior. Activation and first-queryable observations are absent:
this increment has no milestone storage or evidence. Task 10 adds observed
milestones; readiness never implies activation or an invented historical date.

## Reading and persisting

`createCrmSnapshotReader` accepts only source IDs, never event payload copies. User
and Organization reads use a read-only repeatable-read transaction so profile,
billing and Memberships share one committed view. Membership reads test whether
the pair currently exists. Missing sources produce identity-only deletion desired
state without retaining old contact fields. Membership arrays have stable ID order.

`createCrmProjectionStore` has five operations: read desired state, persist a desired
snapshot, bind remote IDs, mark success, and mark failure/blocking. Identical
fingerprints retain the revision and previous outcome. Changed desired state
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

## Checks

`projection.test.ts` runs snapshot and storage behavior against disposable PGlite,
including the new schema source's columns, constraints and unique indexes. It
covers latest identity fields, deployment separation, several Organizations,
Plan/access/readiness distinctions, unknown billing products, deleted sources,
Membership re-addition, unchanged fingerprints, stale revisions, retained remote
IDs and outcome transitions. It does not verify provider behavior or cross-replica
HTTP ordering, which belong to the adapter and synchronizers.
