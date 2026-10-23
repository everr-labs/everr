# 02: Publish committed User lifecycle facts

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [01: Add the typed fire-and-forget publisher](01-best-effort-publisher.md).

Suggested commit: `feat(identity): publish user lifecycle business events`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Define User created, updated, verified, and deleted contracts beside shared identity.
- Inject publication at verified post-commit completion points for password and OAuth signup, profile changes, and verification-token flows.
- Capture real false-to-true verification transitions and source identity before deletion; do not publish a new milestone on repeated updates.
- Keep publication failures separate from genuine identity persistence and authorization failures.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/app/src/identity/`
- `packages/app/src/composition/identity-provider.ts`
- `packages/app/src/app/identity.ts`
- `packages/cloud/src/billing/auth-adapter.server.ts`
- `packages/cloud/src/app/composition/identity.ts`

## Acceptance criteria

- [ ] Successful source mutations publish the appropriate typed facts after the outermost commit.
- [ ] A failed or rolled-back mutation does not publish a committed fact.
- [ ] A failed enqueue/subscriber cannot fail signup or change its result.
- [ ] Existing billing identity locks and validation remain effective.

## Verification in this commit

- Integration tests covering password/OAuth creation, nested Better Auth transactions, verification, rollback, and deletion.
- Inject publication failure and verify the User remains committed.
- Manual auth checks using main-worktree .auth if available; verify added diagnostics in Everr.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
