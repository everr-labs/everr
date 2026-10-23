# 03: Publish Organization and Membership facts

Status: implemented, independently reviewed, and committed as `361211ba8`.

Repository: `everr`.

Depends on: [02: Publish committed User lifecycle facts](02-user-events.md).

Suggested commit: `feat(identity): publish organization and membership events`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Define Organization create/update/delete and Membership add/update/remove contracts with stable subject IDs.
- Cover invitation acceptance, leave, removal, role changes, and actual Organization mutations after commit.
- Capture required relationship IDs before deletion and define parent-deletion cleanup without inventing child facts after cascades.
- Keep event publication separate from critical provisioning enqueue.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/app/src/identity/`
- `packages/cloud/src/organization-provisioning/adapter.server.ts`
- `packages/app/src/db/schema/auth.ts`

## Acceptance criteria

- [x] All ordinary identity entry points share the event definitions and post-commit semantics.
- [x] One User in multiple Organizations retains correct identity and relationship scope.
- [x] Critical lifecycle commands preserve their transactional behavior.
- [x] Source rollback and publication failure have the distinct outcomes required by the plan.

## Verification in this commit

- Behavioral/integration tests for invitation acceptance, leave, role update, parent deletion, rollback, and publication failure.
- Manual membership checks using .auth if available; verify any new telemetry through Everr.

## Implementation and evidence

Implemented October 23, 2026 against task 02 commit `9696b6ce5`. Independent
review is complete, and this ticket is not committed.

- Shared identity owns strict versioned Organization create/update/delete and
  Membership add/update/remove definitions. Organization subjects are stable
  Organization IDs. Membership subjects are the persisted `member.id`, with
  Membership, Organization, and User IDs in the payload. Each Zod reader returns
  independently owned values. Both applications register these definitions with
  no CRM subscribers.
- The task 02 feature adapter is now `identityLifecycleAdapter`. All identity
  facts share its existing real outermost commit boundary. It retains provider
  billing and provisioning wrappers, captures relationship IDs under row locks,
  and revalidates Organization and Membership predicates after acquiring locks.
  Selected creation output fields do not lose the stable identity needed for the
  fact. No generic recorder, UnitOfWork, publisher transaction argument, or outbox
  was added.
- Actual Better Auth endpoints cover invitation acceptance, role update, direct
  removal, leave, Organization create/update/delete, and repeated invitation
  rejection. One invitee in two Organizations retains separate Membership IDs.
  Workspace setup publishes all three inserted identity facts after its existing
  transaction. Onboarding publishes after its standalone Organization update.
- Parent cleanup uses the parent stable ID and future durable remote mappings.
  User and Organization cascade deletions publish the parent fact, without
  fabricating child removals. Better Auth explicitly deletes Membership rows
  during its Organization deletion transaction, so those real removals retain
  their relationship facts before the parent disappears.
- The existing Better Auth create-Organization endpoint commits its Organization
  before inserting the creator Membership. A failed creator insert leaves the
  Organization committed and its creation fact intact, with no Membership fact.
  This ticket does not change that source behavior. Critical cloud provisioning
  and cleanup enqueue remain atomic with the Organization mutation; forced job
  persistence failure rolls back the affected source rows and suppresses facts.
- Direct billing owner repair in `packages/cloud/src/billing/subscription.ts`
  (`ensureOrganization`), downgrade removals, and readiness are recorded for task 04. No cloud CRM handlers, migrations, or new telemetry were introduced.

Checks passed:

- App: 64 tests across Organization/Membership and User lifecycle, installation,
  invitations, onboarding store/server, and publisher suites. Three PostgreSQL
  concurrency tests are skipped in the PGlite run.
- Cloud: 94 tests across billing auth integration, billing module, membership
  policy, and Organization persistence/provisioning. The new combined shared
  identity and cloud persistence test forces provisioning and cleanup enqueue
  failure, proving rollback and no facts while preserving existing commands.
- Real PostgreSQL 17: all 10 Organization/Membership tests passed in the isolated
  `everr-task03-identity-postgres` container at `127.0.0.1:55433`, including actual
  endpoint paths, nested commit and rollback, separate-connection publication
  visibility, publication failure, parent cleanup, and three concurrent writer
  races for delete, deleteMany, and updateMany. The races prove a changed original
  predicate does not cause a false fact or an unintended mutation after row-lock
  acquisition.
- App and cloud TypeScript checks, scoped lint, formatting, and whitespace checks
  passed. Logs are retained locally in
  `.verify-everr/artifacts/task03-organization-membership/`.
- The isolated PostgreSQL container, its temporary filesystem, and its listener
  were removed after verification. PGlite remains a single-connection fixture and
  does not supply the separate-connection proof.
- Main-worktree `.auth` is absent, so authenticated manual membership checks were
  skipped under AGENTS.md. The unchanged publisher diagnostic retains task 01's
  verified Everr ingestion proof; this ticket makes no new ingestion claim.

## Independent review and fixes

Standards review found no material repository-rule violations. Spec review found
and fixed one source-semantics regression: the initial single `update` and
`delete` wrappers retained only the first Organization or Membership matching a
predicate, although the underlying adapter mutates all matching rows. These
operations now retain every locked, revalidated match and publish the corresponding
facts after commit. Multi-Organization deletion uses the provider's existing bulk
path so every deleted Organization retains transactional resource cleanup and
deprovisioning enqueue. No new policy restriction or generic abstraction was added.

- A targeted adapter regression updates and deletes two matching Organizations
  and Memberships while preserving an unrelated Organization and Membership.
- The combined cloud regression now covers multi-Organization deletion, resource
  cleanup, two deprovisioning jobs, parent facts without invented child facts,
  and complete rollback when enqueue fails.
- Post-fix focused app checks: 42 passed across five suites, with three
  PostgreSQL-only races skipped. Cloud persistence/provisioning: 12 passed.
- Post-fix real PostgreSQL 17: all 11 Organization/Membership tests passed,
  including the new multi-match regression and all three concurrent writer races.
  The isolated `everr-task03-review-postgres` container, its tmpfs database, and
  its listener were removed after verification.
- App and cloud TypeScript checks, scoped lint, formatting, and whitespace checks
  passed. Review logs are retained alongside implementation evidence in
  `.verify-everr/artifacts/task03-organization-membership/`, using the
  `everr-task03-review-*` prefix. The initial sandbox-only PostgreSQL connection
  attempt was blocked by local networking permissions; the actual PostgreSQL run
  passed with the required local access.
- Main-worktree `.auth` remains absent, so authenticated manual checks remain
  skipped. No telemetry changed, and no new ingestion claim is made.

Committed by the coordinating agent as `361211ba8`. No material findings remained at commit.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
