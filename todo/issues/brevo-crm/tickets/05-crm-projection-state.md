# 05: Add cloud CRM projection state and snapshot mapping

Status: implemented, independently reviewed, and committed as `f0bbeef65`.

Repository: `everr`.

Depends on: [00: Record the agreed integration plan](00-planning-baseline.md).

Suggested commit: `feat(crm): model cloud synchronization state and snapshots`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Define cloud-only remote-ID mappings, snapshot/revision state, synchronization outcome, and retained deletion tombstones.
- Implement desired User and Organization snapshots from current authoritative state, including current Membership associations.
- Keep Plan, subscription status, app access state, provisioning, and activation fields separate.
- Define deployment-scoped identifiers and Everr-owned fields; preserve CRM-owned notes and communication preferences.
- Change schema sources without automatically generating or applying migrations.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`
- `packages/cloud/src/db/schema/`
- `packages/cloud/src/billing-data.server.ts`

## Acceptance criteria

- [x] User/contact and Organization/company identities are stable across email or display-name changes.
- [x] Mappings remain usable for cleanup after source deletion.
- [x] Snapshots handle several Organizations per User and suspended Pro access correctly.
- [x] The self-hosted composition needs neither these tables nor CRM configuration.

## Verification in this commit

- Behavioral snapshot and storage tests for multi-Organization membership, Plan/access differences, source deletion, and revision state.
- Typecheck cloud schema integration; confirm no generated migration artifacts.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.

## Implementation evidence

- Added the cloud-only `crmProjection` schema source and export, with no source
  foreign keys, stable deployment-scoped identity, entity and relationship remote
  IDs, desired/synchronized fingerprints and guarded revisions, failure/success
  state, and retained deletion tombstones.
- Added current-source snapshot readers for Users, Organizations and Membership
  pairs. Organization reads reuse `readOrgEntitlement` through an optional database
  executor; no duplicate billing policy was introduced. User/Organization snapshot
  reads use a read-only repeatable-read transaction. Several Organizations per User
  are retained explicitly.
- Documented source-owned fields, provider attribute namespace and CRM-owned notes,
  preferences and consent in the [module documentation](../../../../packages/cloud/src/crm/README.md).
  Activation and first-queryable observations remain absent until task 10, without
  inferring historic milestones from provisioning or billing.
- Focused verification: 16 tests passed across `projection.test.ts` and
  `billing-data.server.test.ts`. Eight new PGlite behavioral cases cover current
  identity changes, namespaces, multiple Organizations, billing/access/readiness,
  deletion retention, Membership removal/re-addition, revisions, outcomes and
  remote identity conflicts. Existing billing entitlement cases also passed.
- Cloud TypeScript passed with `packages/cloud/node_modules/.bin/tsc --noEmit -p
  packages/cloud/tsconfig.json`. Scoped `vp lint`, `vp fmt --check` and
  `git diff --check` passed. Schema ownership inspection found CRM only in the
  cloud schema/module, with no imports from shared/self-hosted composition.
  Migration directories have no changed files. No schema migration is generated
  or applied to an application database. Only disposable test databases receive
  schema DDL.
- Authenticated manual app checks are skipped because the main-worktree `.auth`
  file is absent. No UI, provider traffic, worker registration, configuration
  activation or new telemetry is introduced.
- Independent review is complete. Standards and spec review found no material
  findings, so no implementation fixes were required. The separate reviewer
  reran all 16 focused tests and cloud TypeScript successfully. Review covered
  stable deployment identity, current multi-Organization Memberships,
  authoritative entitlement reuse within one repeatable-read source view,
  source-deletion retention, terminal entity tombstones, Membership re-addition,
  stale revision outcomes, and independent remote identity binding.
- Independent review evidence: `/private/tmp/task05-review-tests.log` (16 passed),
  `/private/tmp/task05-review-types.log` (TypeScript, exit 0), and
  `/private/tmp/task05-review-style.log` (scoped lint, formatting, whitespace and
  ownership checks). No new migration artifacts, provider calls, activation,
  shared CRM imports or telemetry were introduced. The coordinating agent committed
  this independently reviewed task as `f0bbeef65`.
