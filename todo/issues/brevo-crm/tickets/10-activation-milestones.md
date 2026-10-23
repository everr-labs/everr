# 10: Persist verified activation milestones and sync their fields

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [01: Add the typed fire-and-forget publisher](01-best-effort-publisher.md), [05: Add cloud CRM projection state and snapshot mapping](05-crm-projection-state.md), [08: Synchronize Organizations and Membership associations](08-organization-association-sync.md).

Suggested commit: `feat(crm): track verified organization activation milestones`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Define a typed useful-consultation observation interface without exposing Brevo to query modules.
- Add cloud-owned once-per-Organization milestone persistence with rule version and observation time.
- Require queryable own data plus useful completed consultation in the same authorized Organization; a valid consultation may establish both facts.
- Publish milestone events best effort after marker persistence and project them onto the company.
- Contain ancillary observation/marker failures so successful queries stay successful. Do not auto-generate migrations.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`
- `packages/cloud/src/db/schema/`
- `packages/app/src/composition/`
- `CONTEXT.md`

## Acceptance criteria

- [ ] Concurrent valid observations establish activation once; a later quiet period does not reset it.
- [ ] Provisioning, a key creation, positive usage bytes, or subscription alone cannot activate an Organization.
- [ ] Observation failure is measured without changing the completed product action's result.
- [ ] Lost publication can be repaired from a stored milestone; missing history is not assigned an invented timestamp.

## Verification in this commit

- Behavioral storage tests for concurrency, accepted/rejected evidence, Organization scope, timestamp handling, and marker/publication failure.
- Verify milestone failure diagnostics through Everr.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
