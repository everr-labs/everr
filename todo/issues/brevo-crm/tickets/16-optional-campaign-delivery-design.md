# 16: Plan optional historical event delivery for campaigns

Status: planned. This ticket is not implemented.

Repository: `everr`.

Depends on: [14: Document and prove CRM operational readiness](14-operational-readiness.md).

Suggested commit: `docs(crm): specify lifecycle event delivery and recipients`.

This is optional follow-up work and is not required for the CRM rollout.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- After the CRM projection is stable, specify which retained facts should be exported to Brevo Events and who receives Organization-driven communication.
- Define duplicate suppression/recovery and preserve event identity/time without promising exactly-once remote effects.
- Evaluate provider behavior in an isolated account and separate profile sync from event-export consumers.
- This task produces a reviewed campaign-delivery specification, not a silently enabled email automation.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `docs/`
- `packages/cloud/src/crm/ (inspection only)`

## Acceptance criteria

- [ ] Recipient selection preserves the Organization and actual actor, without inventing activity for all Members.
- [ ] The design states that events lost before enqueue cannot be reconstructed as complete historical facts.
- [ ] Backfill cannot accidentally trigger welcome or marketing sequences.
- [ ] Implementation commits and any external campaign activation are planned separately.

## Verification in this commit

- Review provider behavior and duplicate-trigger scenarios using isolated test data.
- Confirm communication preferences and existing CRM projection behavior remain intact.

## Commit boundary

Include the reviewed specification and provider-check evidence only. Do not add
runtime campaign delivery or tests that only assert documentation text. Stage
only this ticket's files and preserve unrelated work. Record any missing provider
verification explicitly, and mark completion only after the acceptance criteria
and independent review are satisfied.
