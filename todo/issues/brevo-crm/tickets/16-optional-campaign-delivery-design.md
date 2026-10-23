# 16: Plan optional historical event delivery for campaigns

Status: optional specification implemented, independently reviewed and included
with this specification commit. No runtime exporter or external automation is enabled.

Repository: `everr`.

Depends on: [14: Document and prove CRM operational readiness](14-operational-readiness.md).

Suggested commit: `docs(crm): specify lifecycle event delivery and recipients`.

This is optional follow-up work and is not required for the CRM rollout.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Specification: [campaign delivery design](../../../../docs/crm-campaign-delivery-design.md).
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

- [x] Recipient selection preserves the Organization and actual actor, without inventing activity for all Members.
- [x] The design states that events lost before enqueue cannot be reconstructed as complete historical facts.
- [x] Backfill design prohibits historical/welcome event emission and requires account automation gates before profile import; remote enforcement remains unverified.
- [x] Implementation commits and any external campaign activation are planned separately.

## Verification in this commit

- Review provider behavior and duplicate-trigger scenarios using isolated test data.
- Confirm communication preferences and existing CRM projection behavior remain intact.

## Commit boundary

Include the reviewed specification and provider-check evidence only. Do not add
runtime campaign delivery or tests that only assert documentation text. Stage
only this ticket's files and preserve unrelated work. Record any missing provider
verification explicitly, and mark completion only after the acceptance criteria
and independent review are satisfied.

## Implementation evidence and deliberate limits

The specification inspects current typed facts and consultation/milestone
publication. Milestone facts carry no actor; a client principal need not identify
a User. Current Owner recipients are a separate explicit policy, never inferred
actors. Queued recipients require fresh User and preference checks; Organization
communication also requires current Membership/access under its recipient policy.
Only retained export jobs can preserve their original event envelope; profile
reconciliation cannot reconstruct lost transition history.

Official Brevo Events, trigger/filter, audience-condition and communication
preference documents were reviewed on October 23, 2026, with primary links beside
the claims. The scenario table is synthetic analysis of duplicate, lost-ack,
crash, backfill, preference and revocation cases, not executed provider tests.
No credential or Brevo request was used. Actual event readback, duplicate-trigger,
re-entry and action-time revocation behavior remain unknown. Task 14's profile
canary does not verify them. Automatic marketing remains blocked pending separate
implementation review, an authorized isolated no-message experiment and explicit
campaign approval. These disclosed gaps are allowed by this design-only ticket.

Task 14 is committed as `54c768cac`; task 15's six-file disabled-default
configuration is reviewed and committed as `1df983b` in `everr-deploy`.
Target schema, CI/durable settings, canary and rollout proof remain pending.
This docs-only ticket makes no runtime, CI, infrastructure, migration or telemetry
change. No documentation/YAML text tests were added. Manual app verification is
skipped because no app changed and main-worktree `.auth` is absent.

## Independent review

Standards and Spec review checked the six scoped documents against repository
rules, the plan, current fact schemas/publishers and the official provider sources.
Review clarified that current Membership/role checks apply to Organization-scoped
communication, while a User-subject fact need not have an Organization. It also
distinguished separate enrollment calls from custom-event-triggered entry and
required the future no-message experiment to exclude automation chaining and
other account messaging paths. No material findings remain.

Scoped formatting, whitespace and local-link checks passed. No runtime or provider
behavior was exercised; remote Events, duplicate triggers and action-time
preferences/revocation remain unverified. These gaps still block future automatic
marketing, and no infrastructure or production enablement is implied.
