# 14: Document and prove CRM operational readiness

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [13: Repair CRM drift after lost events](13-periodic-reconciliation.md).

Suggested commit: `docs(crm): document rollout and recovery procedures`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Document configuration, field provisioning, schema prerequisites, pause/resume, bootstrap, reconciliation, and exhausted-job recovery.
- Run a complete isolated integration exercise and capture verification evidence rather than postponing all testing to this task.
- Update background-work ownership/guarantees to match the implemented fire-and-forget publisher and cloud runner.
- Keep optional campaign delivery outside this rollout. Record provider-contract checks and any remaining blockers.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `docs/background-work.md`
- `docs/brevo-crm-integration-plan.md`
- `packages/cloud/README.md`
- `docs/`

## Acceptance criteria

- [ ] Evidence covers password/OAuth signup, User update, multi-Organization relationships, downgrade, cancellation state, activation, deletion, and repair.
- [ ] A forced event-save failure leaves the User created and produces a diagnostic visible in Everr.
- [ ] Paused/failed Brevo does not break signup, consultation, billing, or provisioning.
- [ ] Manual app checks use main-worktree .auth when available; missing credentials are documented rather than treated as a pass.

## Verification in this commit

- Focused end-to-end exercise in an isolated Brevo account and Everr stack.
- Inspect the changed modules' existing targeted test results and record manual verification evidence.
- Review source/migration prerequisites and safe rollout order before task 15.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
