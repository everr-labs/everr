# 04: Publish cloud billing, Plan, and readiness facts

Status: implemented, independently reviewed, and ready for commit. Not committed.

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
- Cover the direct owner Membership repair insert in `packages/cloud/src/billing/subscription.ts`
  (`ensureOrganization`) after its billing persistence succeeds. Task 03 covers the shared
  auth, workspace setup, and onboarding paths; this billing repair bypasses them.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/billing/events.ts`
- `packages/cloud/src/billing/store.ts`
- `packages/cloud/src/organizations/commands.server.ts`
- `packages/cloud/src/organization-provisioning/runtime.ts`
- `packages/app/src/identity/memberships.ts`

## Acceptance criteria

- [x] Duplicate webhooks, no-op readiness updates, and rollback produce no false transition.
- [x] Downgrade publishes the correct Plan and removed Membership facts after commit.
- [x] A Pro subscription becoming inactive is not incorrectly modeled as an automatic Hobby downgrade.
- [x] CRM event failure does not change billing, provisioning, or downgrade success.

## Verification in this commit

- Integration tests for provider revision ordering, downgrade removals, readiness retries, rollback, and publication failure.
- Preserve existing worker and billing behavior; verify new diagnostics in Everr.

## Implementation evidence

- Added cloud-owned `billing.subscription.changed` and `organization.plan.changed`
  definitions. The shared `organization.provisioned` contract describes readiness
  only. Both compositions register shared readiness; only cloud registers billing.
  Subscriber arrays remain empty, with no CRM handlers or provider calls.
- `saveSubscription` returns accepted-revision and actual Plan-update information
  from its existing transaction, then publishes after it resolves. The conditional
  Plan upsert serializes transition detection with the write. Duplicate and older
  provider revisions publish nothing; accepted inactive Pro revisions do not
  downgrade Plan. Provider validation and billing locks retain their existing paths.
- Hobby downgrade retains removed Membership IDs and publishes after the local
  transaction, before later billing reconciliation can fail. The retained Owner
  remains unchanged, so no `membership.updated` fact is fabricated. The public
  downgrade result still exposes only removal/cancellation counts.
- Owner Membership repair publishes immediately after its standalone insert,
  even if a later checkout operation fails. Readiness publishes only when its
  guarded update returns a transitioned row. Critical provisioning enqueue,
  deletion cleanup, provider revocation, and transaction guarantees are preserved.
- Focused cloud tests: 98 passed across billing module, downgrade, provisioning
  runtime, provisioning persistence adapter, and entitlement suites. Coverage
  includes accepted/duplicate/older revisions, subscription and Plan rollback,
  inactive Pro, scheduled cancellation, downgrade rollback and stable removal IDs,
  later reconciliation failure, repair insert failure/retry, publication exceptions,
  guarded readiness races/retries, and existing critical enqueue/cleanup behavior.
- App and cloud TypeScript checks passed. Scoped lint and formatting passed for
  the implementation. Evidence is retained in
  `.verify-everr/artifacts/task04-cloud-billing-readiness/implementation-checks.md`.
- Tests use disposable PGlite databases closed by their fixtures. No containers,
  listeners, external provider resources, or schema migrations were created.
  PGlite is a single-connection fixture; no new real PostgreSQL concurrency claim
  is made for this ticket. Task 03 retains its PostgreSQL transaction-boundary proof.
- Main-worktree `.auth` is absent, so authenticated manual app verification is
  skipped under AGENTS.md. Publisher diagnostics are unchanged and retain task
  01's verified Everr ingestion evidence; no new telemetry or ingestion claim.

## Independent review

- Reviewed the complete task 04 source and documentation diff against AGENTS.md,
  CONTRIBUTING.md, this ticket, and the integration plan. Standards and spec review
  found no material issues and required no behavioral source fixes. Corrected
  formatter-only layout in three owner repair test fixtures.
- Confirmed subscription facts follow accepted transaction commits, Plan facts
  follow actual conditional writes, and inactive Pro does not become Hobby.
  Duplicate and older provider revisions produce no facts. Direct owner repair
  and downgrade removals retain their committed relationship IDs and publish at
  their own commit boundaries, including when later billing work fails.
- Confirmed readiness follows only a returned guarded pending-to-ready update;
  critical provisioning enqueue and cleanup, provider verification, locks, and
  original source failures remain intact. Both compositions keep empty subscriber
  arrays, with cloud-only billing definitions and no new CRM handlers.
- Independently repeated the five focused cloud suites: 98 tests passed.
  App and cloud TypeScript checks passed. Scoped formatting, whitespace, and
  documentation punctuation checks passed. Review evidence is retained in
  `.verify-everr/artifacts/task04-cloud-billing-readiness/review-checks.md`.
- No new telemetry, provider calls, migrations, containers, or listeners were
  introduced during review. The existing task 01 ingestion proof remains the
  applicable diagnostic evidence. Main-worktree `.auth` is absent, so manual
  authenticated verification remains skipped. PGlite coverage establishes no
  new multi-connection PostgreSQL concurrency claim.

Ready for the coordinating agent's scoped commit. No material findings remain.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
