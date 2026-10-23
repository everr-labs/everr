# 12: Add resumable CRM bootstrap

Status: implemented and independently reviewed. Cancellation finding fixed. Not committed.

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

- [x] An interrupted run resumes from a stable cursor and converges safely with live changes.
- [x] Existing records are updated without duplication or unintended resubscription.
- [x] Unknown historical activation remains unknown.
- [x] Bootstrap uses the same request budget as live work and leaves production integration disabled until rollout.

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

## Implementation evidence

The cloud-only `crm:bootstrap` command accepts explicit page and invocation bounds.
A deployment/account-scoped checkpoint and each page of normal Graphile commands
commit together using the public `add_job` function. This administrative admission
transaction does not change best-effort business publication or add an outbox.
Current workers own source reads, projections, provider budgets and deletion safety.
Users, Organizations, explicit Membership pairs and retained mappings are scanned;
stored Organization milestones flow through the usual latest snapshot. Unknown
history stays unknown. No welcome facts, campaign enrollment or scheduling added.

Resume continues the current scan. A completed repeat is inert unless `--new-scan`
is explicit. Keysets are not a global snapshot; a subsequent cycle covers inserts
behind a cursor. Overlapping page commands fail safely, and checkpoint/admissions
roll back together on interruption or receipt failure. Paused mode admits; disabled
mode refuses before source access. A completed source scan reports admission only,
never provider convergence. Scope and operational constraints are documented in
[the CRM README](../../../../packages/cloud/src/crm/README.md).

Implementation checks and isolated-provider evidence are recorded under
`.verify-everr/artifacts/task12-resumable-bootstrap/`. Independent review is complete;
the coordinator commit is pending. No production activation or application
migration generation/application occurred. `.auth` is absent, so authenticated
manual app verification is skipped under AGENTS.md.

Implementation validation passed 44 real PostgreSQL/Graphile related-sync cases
(10 added for bootstrap), 61 focused CRM regressions, cloud TypeScript and scoped
lint/format/diff checks. The actual installed `tsx` command passed paused bounded
start/resume smoke checks and refused disabled mode. The bounded provider recovery
proof passed on the original own fixtures after an explicitly recorded proof-worker
interruption: two Company links, preserved unknown history, repeat admission with
no scanner HTTP, source-only deletion repair, final Contact/Company 404s and retained
tombstones. No remote fixture was recreated for recovery. The original interrupted
run is not counted as passed. Its PostgreSQL container and all own remote fixtures
were removed. Existing telemetry is reused with no new event, metric or attribute.
Fallow's advisory all-gates audit reports no dead-code/dependency/boundary errors,
but reports complexity and duplication findings; it is not an all-green audit.

## Independent review

Standards review found no material violations. Spec review found that cancellation
during the final admission or checkpoint could still commit the signalled page.
The scanner now checks cancellation immediately before commit. Three actual
PostgreSQL cases cover partial admission, final admission and checkpoint cancellation,
verifying rollback and safe resume. All 46 related PostgreSQL/Graphile cases and
61 focused CRM regressions passed independently, along with cloud TypeScript and
scoped lint/format/diff checks. The first rerun reused an initialized test database
and failed fixture setup; the successful final run used a fresh owned database.
Existing isolated-provider evidence remains applicable; review made no provider
calls or telemetry changes. The owned review PostgreSQL container was removed.
No application migration, production activation or task 13 scheduler was added.
