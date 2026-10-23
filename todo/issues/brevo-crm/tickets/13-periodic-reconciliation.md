# 13: Repair CRM drift after lost events

Status: implemented, independently reviewed and committed as `f23e32eeb`. One repair finding fixed. Prerequisite task 12 is committed as `5b0b092f8`.

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

- [x] A missed User, Membership, Plan, milestone, or deletion event is repaired from current state.
- [x] Reconciliation handles concurrent live mutations and resumes after interruption.
- [x] The repair loop stays within provider budgets and does not fabricate historical lifecycle events.
- [x] Paused/disabled configurations have explicit behavior and do not silently mark work completed.

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

## Implementation evidence

The configured cloud integration runner uses a low-priority minute cron to admit
one page of at most 10 current-state repairs. A separate persisted keyset cycle
resumes atomically and repeats 24 hours after completed admission. Active backlog
backpressure leaves the checkpoint unchanged; paused/disabled modes do not mark
periodic progress. Normal sync/deletion handlers preserve endpoint coordination,
request budgets, mappings, ambiguous Company intent and durable failure allowances.
Fresh completed-revision checks and per-cycle markers detect/repair owned-field
and explicit-pair drift without writing unchanged remote state or repeatedly
refreshing allowance. Missed source publications are repaired from latest state,
including stored milestones and retained deletion identities.

Mapped remote absence is detected and blocked conservatively; automatic remote
mapping replacement is outside this implementation. The README documents exact
inspection/recovery requirements. The explicit `crm:recover` command admits only
expected exhausted revision recovery; execution rechecks under endpoint locks and
never clears identity or Company-create intent. Stale recovery still processes
newer live pending work.

63 real PostgreSQL/Graphile cases, 13 existing User integration cases, 61 focused
CRM regressions and 7 runtime schedule/lifecycle checks passed.
Actual paused/disabled CLI execution and isolated Everr log/counter/gauge queries
are recorded under `.verify-everr/artifacts/task13-periodic-reconciliation/`.
The new pending gauge combines durable projection start and active public queue
creation timestamps, and describes oldest known pending observation, not total
historical backlog age. Task 12 provider contract evidence remains applicable;
no new provider fixtures or production configuration were used. `.auth` is absent,
so authenticated app manual checks are skipped. No UI or app migrations changed.

## Independent review

The distinct reviewer found no material standards violations. The spec review
found one repair gap: the scanner skipped keyed terminal Graphile jobs, so a lost
source update after failure could never reach the authoritative reader. Periodic
admission now preserves active jobs and reassesses retained terminal work without
resetting unchanged projection blocks or exhausted allowances.

A real PostgreSQL/Graphile runner regression proves unchanged exhaustion makes no
HTTP request, then a newer source change with no publication reaches a fresh
synced revision. All 64 related integration cases, 13 User cases and 68 focused
CRM/runtime checks passed independently (145 total), along with cloud TypeScript,
scoped lint/format and diff checks. The README clarifies that Graphile replay
alone does not reset durable state, and ordinary blocks below eight failures or
mapped missing records require a separate supported recovery procedure.

Existing isolated Everr and provider evidence remains applicable. Review made no
provider calls, telemetry changes, production changes or migrations. The isolated
review PostgreSQL container was removed. Coordinator commit: `f23e32eeb`.
