# 08: Synchronize Organizations and Membership associations

Status: implemented and independently reviewed; dependency recovery finding fixed and
checks passed. Real isolated provider relationships and telemetry ingestion passed.
Committed as `179230af5`.

Repository: `everr`.

Depends on: [03: Publish Organization and Membership facts](03-organization-membership-events.md), [04: Publish cloud billing, Plan, and readiness facts](04-cloud-billing-readiness-events.md), [07: Synchronize Users through a cloud integration runner](07-user-sync-worker.md).

Suggested commit: `feat(crm): synchronize organizations and contact associations`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Implement company projection using persisted remote-ID mappings and latest Organization state.
- Subscribe cloud handlers to Organization, Membership, readiness, subscription, and Plan facts.
- Ensure prerequisite contacts/companies exist before linking, and remove obsolete associations without overwriting unrelated CRM data.
- Apply the same endpoint budget and per-entity coordination to live work and partial recovery.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`
- `packages/cloud/src/app/composition/`

## Acceptance criteria

- [x] Two Organizations sharing an email domain remain separate companies.
- [x] One contact can link to several Organizations; removing one Membership removes only that association.
- [x] Plan, subscription, suspended access, and readiness are represented independently.
- [x] Partial remote success and out-of-order jobs converge without repeated company creation.

## Verification in this commit

- Integration/adapter tests for same-domain Organizations, multiple Owners, Membership changes, suspended Pro, and partial association failure.
- Verify representative contact/company relationships in an isolated Brevo account.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.

## Implementation evidence

The cloud runner now reads latest Organization and explicit Membership pair state,
coalesces durable commands, coordinates both endpoints with parent User/Organization jobs,
retains Company create intent before POST, and persists Company reads across 36-second
quota deferrals. Source events remain fire and forget after commit. No source transaction
spans HTTP and no schema migration was generated/applied.

Eighteen actual PostgreSQL/Graphile checks passed, including same-domain Organizations,
multiple Owners, one Contact linked to several Companies, pair removal/re-addition,
suspended Pro, partial links, out-of-order source changes, lost accepted creates,
failed local binding, persisted GET/PATCH phases, bounded prerequisite jobs, lock-session
loss, revision retry allowances and native retry after failed successor insertion.
Seventy existing CRM checks and seventeen worker/helper regressions passed. Cloud/app
typechecks, scoped lint/formatting and Fallow ownership/import checks passed.

The isolated real provider proof used marker
`task08-30f70837-79a7-4577-a51b-a674a656cc79`, linked one Contact to two distinct Companies,
removed one Membership, and verified the other Company still linked by GET. Cleanup
deleted its two Companies and one Contact. Eleven general and three contact calls used
shared pacing; required provider fields were already present from task 06. No preexisting
record or communication channel was touched. Evidence and source harness are preserved
under `.verify-everr/artifacts/task08-organization-sync/`.

The proof exposed eager prerequisite fanout amplification. Final code admits stable
projection job keys with `preserve_run_at`, preserves durable retry progress and fans
out only after successful/already synchronized parent work. The bounded PostgreSQL
job-count regression verifies the correction; the real proof was not rerun.

Fresh Everr queries confirmed `crm.organization.sync`/`crm.membership.sync` logs,
`everr.crm.organization.id` only on logs, bounded entity/outcome metric dimensions,
outcome counter unit `1`, and lag histogram unit `s`. No profile fields or provider
payloads appear in telemetry. Production ingestion and activation are unverified.

Full entity deletion and orphan cleanup remain task 09. Lock-connection loss aborts
requests, but Brevo has no fencing token: a sent request may still be accepted late.
Ambiguous Company recovery is bounded inventory recovery and cannot authorize blind
recreation. `.auth` is absent, so authenticated manual app checks were skipped.

Independent review: complete. One material spec finding was fixed: a pair blocked by
an unsafe prerequisite remained blocked after that parent recovered, even though its
Membership snapshot was unchanged. Only `prerequisite_blocked` now revalidates current
parents under both endpoint locks; pair identity/provider blocks remain inspectable.
The pair keeps its desired revision and durable retry count until normal success.
The new PostgreSQL regression failed before the fix and passed afterward, including
retained allowance advancement from two to three on an intervening association failure.
All 19 related PostgreSQL/Graphile cases, 13 existing User integration cases and 59
focused CRM cases passed independently. Cloud typechecking and scoped lint/formatting
passed. No new standards finding remained. Provider and telemetry evidence remains
applicable without another live run. Commit: not created by the review agent.
