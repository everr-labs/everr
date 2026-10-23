# 13: Repair CRM drift after lost events

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [12: Add resumable CRM bootstrap](12-resumable-bootstrap.md).

Suggested commit: `feat(crm): reconcile cloud CRM state periodically`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Add bounded periodic reconciliation through the cloud integration runner.
- Detect missing contacts/companies, changed owned fields, missing/stale associations, and orphaned mappings.
- Reuse bootstrap/sync/cleanup primitives and persist progress. Skip unchanged snapshots.
- Expose reconciliation drift, oldest pending sync, failures, and explicit exhausted-job recovery.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`
- `packages/cloud/src/app/composition/runtime.ts`

## Acceptance criteria

- [ ] A missed User, Membership, Plan, milestone, or deletion event is repaired from current state.
- [ ] Reconciliation handles concurrent live mutations and resumes after interruption.
- [ ] The repair loop stays within provider budgets and does not fabricate historical lifecycle events.
- [ ] Paused/disabled configurations have explicit behavior and do not silently mark work completed.

## Verification in this commit

- Drop initial publication deliberately, then verify reconciliation restores the expected contact/company/association state.
- Tests for drift, deletion, partial progress, quota limits, and concurrent live work.
- Verify sync/repair failures and progress telemetry through Everr.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
