# 12: Add resumable CRM bootstrap

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [09: Handle deletion and stale remote mappings](09-deletion-cleanup.md), [11: Observe useful consultation across UI, CLI, and MCP](11-query-value-observations.md).

Suggested commit: `feat(crm): add resumable bootstrap for existing accounts`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Add a paginated, checkpointed bootstrap path for existing Users, Organizations, Memberships, and known milestones.
- Reuse projection handlers, stable mappings, endpoint budgets, and deletion safeguards.
- Support resume and repeat runs without sending welcome events or enrolling imported contacts into campaigns.
- Report progress and failures without loading the entire customer database into memory.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`
- `packages/cloud/scripts/`

## Acceptance criteria

- [ ] An interrupted run resumes from a stable cursor and converges safely with live changes.
- [ ] Existing records are updated without duplication or unintended resubscription.
- [ ] Unknown historical activation remains unknown.
- [ ] Bootstrap uses the same request budget as live work and leaves production integration disabled until rollout.

## Verification in this commit

- Behavioral tests for pagination, interruption/resume, repeated import, concurrent live updates, and quota exhaustion.
- Small isolated Brevo bootstrap with representative multi-Organization users and deleted mappings.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
