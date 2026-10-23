# 04: Publish cloud billing, Plan, and readiness facts

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [03: Publish Organization and Membership facts](03-organization-membership-events.md).

Suggested commit: `feat(cloud): publish billing and provisioning business events`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Add cloud-owned subscription/Plan contracts and publish only after accepted source transactions commit.
- Skip duplicate or older Polar revisions that do not change authoritative state.
- Publish provisioning readiness only for an actual guarded pending-to-ready transition.
- Cover downgrade-to-Hobby and its direct Membership removals, which bypass ordinary auth hooks.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/billing/events.ts`
- `packages/cloud/src/billing/store.ts`
- `packages/cloud/src/organizations/commands.server.ts`
- `packages/cloud/src/organization-provisioning/runtime.ts`
- `packages/app/src/identity/memberships.ts`

## Acceptance criteria

- [ ] Duplicate webhooks, no-op readiness updates, and rollback produce no false transition.
- [ ] Downgrade publishes the correct Plan and removed Membership facts after commit.
- [ ] A Pro subscription becoming inactive is not incorrectly modeled as an automatic Hobby downgrade.
- [ ] CRM event failure does not change billing, provisioning, or downgrade success.

## Verification in this commit

- Integration tests for provider revision ordering, downgrade removals, readiness retries, rollback, and publication failure.
- Preserve existing worker and billing behavior; verify new diagnostics in Everr.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
