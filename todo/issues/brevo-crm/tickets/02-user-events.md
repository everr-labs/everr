# 02: Publish committed User lifecycle facts

Status: implemented, independently reviewed, and committed as `9696b6ce5`.

Repository: `everr`.

Depends on: [01: Add the typed fire-and-forget publisher](01-best-effort-publisher.md).

Suggested commit: `feat(identity): publish user lifecycle business events`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Define User created, updated, verified, and deleted contracts beside shared identity.
- Inject publication at verified post-commit completion points for password and OAuth signup, profile changes, and verification-token flows.
- Capture real false-to-true verification transitions and source identity before deletion; do not publish a new milestone on repeated updates.
- Keep publication failures separate from genuine identity persistence and authorization failures.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/app/src/identity/`
- `packages/app/src/composition/identity-provider.ts`
- `packages/app/src/app/identity.ts`
- `packages/cloud/src/billing/auth-adapter.server.ts`
- `packages/cloud/src/app/composition/identity.ts`

## Acceptance criteria

- [x] Successful source mutations publish the appropriate typed facts after the outermost commit.
- [x] A failed or rolled-back mutation does not publish a committed fact.
- [x] A failed enqueue/subscriber cannot fail signup or change its result.
- [x] Existing billing identity locks and validation remain effective.

## Verification in this commit

- Integration tests covering password/OAuth creation, nested Better Auth transactions, verification, rollback, and deletion.
- Inject publication failure and verify the User remains committed.
- Manual auth checks using main-worktree .auth if available; verify added diagnostics in Everr.

## Implementation and evidence

Implemented October 23, 2026, against task 01 commit `c4dca85c1`.
Independent review is complete. The coordinating agent committed this ticket as
`9696b6ce5`.

- Shared identity owns strict versioned User facts and the typed
  `EventPublisher<UserEvent>` producer seam. Payloads contain the stable User ID;
  creation also records initial verified status. Zod readers return independently
  owned values. Both compositions register the definitions with no subscribers.
- `userLifecycleAdapter` owns the existing Better Auth persistence boundary.
  The provider builds its adapter for the supplied executor, preserving cloud
  billing and Organization provisioning wrappers in nested transactions. Facts
  accumulate only inside this feature adapter and publish after its outermost
  transaction resolves. No generic transaction-event API or outbox was added.
- Installed Better Auth 1.6.33 uses `runWithTransaction` for password and OAuth
  creation, reuses its active transaction, and drains queued database after-hooks
  even after a rollback. Its default Drizzle adapter also disables transactions.
  Forced account-constraint failures prove that its User after-hook can run while
  the User insert rolls back. Publication therefore uses the adapter's real
  transaction completion, never that hook queue.
- User update and delete snapshots take row locks in the source transaction,
  retaining the prior stable identity. Verification emits a milestone only for
  persisted false-to-true transitions. Repeated verification and initially
  verified OAuth creation do not fabricate milestones. Existing identity request
  scopes and lifecycle locks last through commit and publication.
- Cloud billing validation still runs before writing. Reconciliation receives
  the written identity override because another database connection can still
  see the prior row while the source transaction is open. Nested adapter tests
  cover validation failure, the unchanged row, no fact, and lock-scope release.
- Direct `setupWorkspace` User insertion publishes its created fact only after
  setup commits. The audit found no other production direct Drizzle User writes
  or User batch update/delete adapter callers. User batch APIs are not newly
  instrumented in this ticket. Organization and Membership facts remain task 03.
- Publication failures are isolated from committed identity results. An actual
  password signup with the real publisher and a rejected subscriber remains
  committed with its credential row and records the existing publication
  diagnostic. A broken injected publisher also cannot change the result.

Checks passed:

- App: 40 tests across User lifecycle, installation, invitations, and publisher
  suites. Setup tests assert created-fact success and rollback suppression. An
  existing expiration fixture now uses a fixed past timestamp to avoid local
  database timezone differences.
- Cloud: 93 tests across billing auth integration, billing module, membership
  policy, and Organization persistence/provisioning regression suites.
- Real PostgreSQL 17: the seven User lifecycle tests passed using an isolated
  `postgres:17-alpine` container, including password/OAuth rollback, nested
  transactions, verification/repeats, deletion, and actual signup surviving a
  failed subscriber. The container `everr-task02-identity-postgres`, its temporary
  volume, and its `127.0.0.1:55432` listener were removed afterward.
- App and cloud TypeScript checks, scoped lint, formatting, and whitespace checks
  passed. Logs are retained locally in
  `.verify-everr/artifacts/task02-user-events/`.
- The PGlite auth fixture routes hook reads through its active transaction because
  its single connection otherwise waits on itself. It cannot prove separate
  connection visibility; the PostgreSQL run supplies the real transaction proof.
- Main-worktree `.auth` is absent, so authenticated manual checks were skipped
  under AGENTS.md. No new telemetry was introduced. The unchanged publisher
  diagnostic retains task 01's verified Everr ingestion proof; no new ingestion
  claim is made here. No migrations were generated.

## Independent review

Completed October 23, 2026 by a separate review-and-fixes agent against task 01
baseline `c4dca85c1`. Standards and Spec reviews found no material code issues;
no code fixes were necessary.

- Verified actual root transaction completion owns publication, nested adapters
  preserve cloud wrappers, and rollback discards captured facts. Publication is
  fire and forget and cannot mask genuine source failures.
- Reviewed request lock lifetime through root commit, row locking for verification
  transitions, deletion identity capture, and the billing override used while a
  separate connection can still see the previous identity.
- Repeated the mutation-path audit: setup is the only direct production Drizzle
  User mutation outside the adapter, and the configured production paths have no
  User batch update/delete callers.
- Independently reran the four targeted app suites (40 tests) and four cloud
  regression suites (93 tests), all passing. Whitespace checks passed. The earlier
  PostgreSQL evidence remains applicable because review changed documentation
  only. Main-worktree `.auth` is absent, so manual auth checks remain skipped.

The coordinating agent committed the reviewed scope as `9696b6ce5`. CRM handlers
remain disabled.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
