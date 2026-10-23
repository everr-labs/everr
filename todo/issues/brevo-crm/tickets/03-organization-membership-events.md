# 03: Publish Organization and Membership facts

Status: planned. This ticket is not implemented.

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

- [ ] All ordinary identity entry points share the event definitions and post-commit semantics.
- [ ] One User in multiple Organizations retains correct identity and relationship scope.
- [ ] Critical lifecycle commands preserve their transactional behavior.
- [ ] Source rollback and publication failure have the distinct outcomes required by the plan.

## Verification in this commit

- Behavioral/integration tests for invitation acceptance, leave, role update, parent deletion, rollback, and publication failure.
- Manual membership checks using .auth if available; verify any new telemetry through Everr.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
