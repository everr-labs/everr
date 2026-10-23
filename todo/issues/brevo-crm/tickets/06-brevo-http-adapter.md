# 06: Implement the Brevo HTTP adapter and request budgets

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [05: Add cloud CRM projection state and snapshot mapping](05-crm-projection-state.md).

Suggested commit: `feat(crm): add Brevo API adapter with bounded retries`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Add a cloud-only Brevo adapter for contact/company CRUD and explicit associations, with bounded HTTP timeout and cancellation.
- Classify transient, rate-limit, permanent, and ambiguous-create outcomes. Enforce endpoint request budgets across replicas.
- Preserve opt-outs during email changes and avoid automatic merging on identity conflicts.
- Add cloud-only disabled/configured/paused configuration semantics. Loading the app must not contact Brevo.
- Verify company recovery/lookup behavior against the provider before treating ambiguous POST retry as safe.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/brevo/`
- `packages/cloud/src/app/env.ts`

## Acceptance criteria

- [ ] Tests can exercise the adapter through a fake HTTP transport without production credentials.
- [ ] Timeouts and rate limits do not cause fast retry loops or an unbounded request backlog.
- [ ] Missing credentials in disabled mode require no provider calls; paused work is not reported as delivered.
- [ ] Unknown company-create outcomes are surfaced for recovery instead of blindly issuing another create.

## Verification in this commit

- HTTP behavior tests for status classification, timeout, cancellation, shared quota, identity conflicts, and email opt-outs.
- Use an isolated Brevo account to confirm contact identifiers, company fields/lookup, and ambiguous-create recovery when credentials are available.
- Inspect logs to ensure they contain no contact payloads or credentials.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
