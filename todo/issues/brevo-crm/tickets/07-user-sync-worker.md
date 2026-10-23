# 07: Synchronize Users through a cloud integration runner

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [02: Publish committed User lifecycle facts](02-user-events.md), [06: Implement the Brevo HTTP adapter and request budgets](06-brevo-http-adapter.md).

Suggested commit: `feat(crm): synchronize users through cloud worker handlers`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Implement the User/contact projection handler, reading latest state and updating only changed Everr-owned fields.
- Add independent best-effort Graphile enqueue as a cloud subscriber to User create/update/verification facts.
- Register a cloud integration runner through ApplicationRuntime.registerWorkers with its own execution capacity.
- Add persisted retry, pause, task payload validation, per-entity coordination across replicas, and synchronization diagnostics.
- Keep integration disabled by default until the rollout prerequisites in the task index are met.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`
- `packages/cloud/src/app/composition/runtime.ts`
- `packages/cloud/src/app/composition/identity.ts`
- `packages/cloud/src/worker-runtime.test.ts`

## Acceptance criteria

- [ ] A User event produces a persisted consumer job only in cloud; the worker syncs the latest User.
- [ ] Publication failure is measured but never changes auth success.
- [ ] Delayed/concurrent jobs cannot regress a newer email or recreate an already deleted User.
- [ ] CRM failures do not consume the reserved provisioning capacity or product alert slots.

## Verification in this commit

- Behavioral worker tests for delayed state, concurrent updates, rejected enqueue, payload validation, pause, retry, and shutdown.
- Run both composition/build ownership checks and manual auth flow where .auth is available.
- Verify forced enqueue failure and successful retry diagnostics through Everr.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
