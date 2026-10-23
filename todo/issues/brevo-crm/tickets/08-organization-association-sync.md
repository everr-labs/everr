# 08: Synchronize Organizations and Membership associations

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [03: Publish Organization and Membership facts](03-organization-membership-events.md), [04: Publish cloud billing, Plan, and readiness facts](04-cloud-billing-readiness-events.md), [07: Synchronize Users through a cloud integration runner](07-user-sync-worker.md).

Suggested commit: `feat(crm): synchronize organizations and contact associations`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Implement company projection using persisted remote-ID mappings and latest Organization state.
- Subscribe cloud handlers to Organization, Membership, readiness, subscription, and Plan facts.
- Ensure prerequisite contacts/companies exist before linking, and remove obsolete associations without overwriting unrelated CRM data.
- Apply the same endpoint budget and per-entity coordination to live work and partial recovery.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`
- `packages/cloud/src/app/composition/`

## Acceptance criteria

- [ ] Two Organizations sharing an email domain remain separate companies.
- [ ] One contact can link to several Organizations; removing one Membership removes only that association.
- [ ] Plan, subscription, suspended access, and readiness are represented independently.
- [ ] Partial remote success and out-of-order jobs converge without repeated company creation.

## Verification in this commit

- Integration/adapter tests for same-domain Organizations, multiple Owners, Membership changes, suspended Pro, and partial association failure.
- Verify representative contact/company relationships in an isolated Brevo account.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
