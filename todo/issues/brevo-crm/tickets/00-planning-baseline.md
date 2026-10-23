# 00: Record the agreed integration plan

Status: complete, independently reviewed and committed by the coordinating agent
as `8a9145de251c80bea7f46dc494bd0a3d17494351`. No application implementation is
included in that commit.

Repository: `everr`.

Depends on: None.

Suggested commit: `docs(crm): define Brevo integration and implementation tasks`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Prepare the integration plan, this task index and tickets, and the confirmed Activated organization definition in CONTEXT.md for a documentation-only commit after independent review.
- Keep publication best effort after commit, with cloud-only CRM consumers. Preserve the distinction between provisioning, first queryable data, activation, activity, and billing.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `docs/brevo-crm-integration-plan.md`
- `CONTEXT.md`
- `todo/issues/brevo-crm/`

## Acceptance criteria

- [x] Documentation consistently uses `events.publish(event): void` and the agreed activation definition.
- [x] Only the scoped planning files are prepared for review; unrelated docs/research and local changes are excluded.
- [x] No application implementation is included in the prepared change.
- [x] A separate review-and-fixes agent has completed independent review.
- [x] The coordinating agent staged only the scoped planning files and committed the reviewed result.

## Verification in this commit

- Review local links and dependency order; check whitespace and the repository's documentation punctuation rule.

Implementation checks: all relative Markdown links in the scoped planning files
resolve without relying on untracked research drafts; all 17 tickets exist and
their prerequisite order matches the index; scoped whitespace checks pass; the
new planning files and added glossary definition contain no em or en dashes.
This is prose-only work, so application tests and telemetry ingestion checks do
not apply. No runtime telemetry, code, schema, or generated migration changed.

Independent review: rechecked all 77 local Markdown links, all 17 tickets and
their index/prerequisite order, the four-line glossary addition, whitespace,
and punctuation. Inspected the existing worker composition, billing transaction,
readiness transition, and direct Membership-removal paths against the proposed
ownership and publication sites. Rechecked the cited provider documentation;
isolated-account behavior remains a future implementation check, not a claimed
pass. Clarified that the agreed activation rule also supersedes the older
first-ingestion proposal in background-work.md and made the nonthrowing diagnostic
boundary explicit in the index. No blocking review findings remain. The coordinating agent committed the reviewed planning result as `8a9145de2`
(`docs(crm): define Brevo integration and implementation tasks`). Task 01 now has
its separate implementation and review stages recorded in the execution ledger.

## Commit boundary

Include only the new Activated organization glossary definition, integration
plan, task index, and ticket files. Preserve unrelated work. No code or prose-only
tests belong in this commit. The implementation agent does not stage or commit;
the coordinating agent does so after the independent review has passed. Record
review and commit completion truthfully before marking this ticket complete.
