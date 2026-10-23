# 09: Handle deletion and stale remote mappings

Status: implemented and independently reviewed; checks passed, awaiting coordinator commit.

Repository: `everr`.

Depends on: [08: Synchronize Organizations and Membership associations](08-organization-association-sync.md).

Suggested commit: `feat(crm): reconcile deleted users and organizations`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Subscribe to deletion facts and clean up only Everr-owned contacts, companies, and associations.
- Preserve mapping/tombstone information through cleanup and implement orphan checks against existing source IDs.
- Make deletion cleanup safe to repeat and prevent older queued upserts from recreating a deleted entity.
- Provide the deletion reconciliation primitive used later by the periodic reconciler.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`

## Acceptance criteria

- [x] Cleanup works after the source row has gone, including when its deletion event was lost.
- [x] An absent remote record is a successful idempotent cleanup outcome.
- [x] Unrelated contacts/companies and a User's other Organization associations survive.
- [x] Deletion followed by a new User with the same email does not merge or resurrect the old identity.

## Verification in this commit

- Behavioral tests for missing events, cascades, delete-versus-upsert concurrency, already-deleted remote data, and same-email recreation.
- Manual deletion check using .auth if available and an isolated Brevo account.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.

## Implementation evidence and limits

Deletion consumers use the existing coordinated parent tasks, retaining tombstones,
remote IDs and Company intent. Destructive requests verify exact deployment identity;
missing mapped records are successful cleanup. Unbound attempted Company creates use
bounded recovery and remain inspectable when absent, duplicated or beyond inventory
bounds. A separate durable cleanup read bridges the general quota gap without reusing
an upsert cache. The bounded keyset orphan primitive admits missing-source work into
normal tasks, including explicit rechecks of completed tombstones after late provider
acceptance. Repair metadata records detection time and a check ID, rather than a
fabricated deletion fact. A revision guard prevents duplicate repair commands from
reopening the same completed cleanup repeatedly. The periodic scheduler remains task 13.

Checks: 33 related real PostgreSQL/Graphile cases, 13 existing User cases, 60 focused
CRM cases, cloud types, scoped lint/formatting and diff whitespace checks. The provider
proof created/deleted one isolated Contact and Company through the coordinated handlers
and verified remote 404 plus retained tombstones (four general, five contact requests).
Evidence: `.verify-everr/artifacts/task09-deletion-cleanup/report.md`.
No new telemetry was added. `.auth` is absent, so authenticated manual app checks were
skipped. No application migrations were generated/applied or production configuration
changed; the integration stays disabled by default and cloud-only.

Remote ownership edits after a cached verification and late provider acceptance after
lock-session loss cannot be conditionally fenced by Brevo. Source transactions never
span HTTP. Cleanup does not reset stale mappings, recreate removed identities, or
blindly repeat uncertain creates. Independent review is complete; commit is pending.

## Independent review

Standards and spec review found no material issues requiring a code change. Review
checked exact external/remote identity ownership, retained mappings, cleanup quota
progress, retry exhaustion, parent/pair coordination and same-email isolation.
The orphan primitive only queues source identities, so the coordinated handler
rereads a source changed after paging before saving desired state. A completed
tombstone recheck opens only its observed revision; duplicate/older commands cannot
reset pending, blocked or exhausted cleanup, and re-added Memberships use current
source state.

Independently reran all 60 focused CRM tests and the cloud TypeScript check, with
scoped lint/format and whitespace checks. The implementation's 33 related and 13
User real PostgreSQL/Graphile checks and isolated provider proof remain applicable;
review changed documentation only and made no provider calls. Existing telemetry
evidence remains applicable because no telemetry changed. `.auth` remains absent.
Commit: not created by the review agent.
