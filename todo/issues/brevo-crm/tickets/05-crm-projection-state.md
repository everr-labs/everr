# 05: Add cloud CRM projection state and snapshot mapping

Status: planned. This ticket is not implemented.

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

- [ ] User/contact and Organization/company identities are stable across email or display-name changes.
- [ ] Mappings remain usable for cleanup after source deletion.
- [ ] Snapshots handle several Organizations per User and suspended Pro access correctly.
- [ ] The self-hosted composition needs neither these tables nor CRM configuration.

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
