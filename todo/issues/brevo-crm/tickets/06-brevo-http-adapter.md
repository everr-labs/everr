# 06: Implement the Brevo HTTP adapter and request budgets

Status: implemented and independently reviewed; local checks and isolated-provider
verification passed. Committed as `af829e766`.

Repository: `everr`.

Depends on: [05: Add cloud CRM projection state and snapshot mapping](05-crm-projection-state.md).

Suggested commit: `feat(crm): add Brevo API adapter with bounded retries`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Add a cloud-only Brevo adapter for contact/company CRUD and explicit associations, with bounded HTTP timeout and cancellation.
- Classify transient, rate-limit, permanent, and ambiguous-create outcomes. Enforce endpoint request budgets across replicas.
- Preserve opt-outs during email changes and avoid automatic merging on identity conflicts.
- Add cloud-only disabled/configured/paused configuration semantics. Loading the app must not contact Brevo.
- Verify company recovery/lookup behavior against the provider before treating ambiguous POST retry as safe.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/brevo/`
- `packages/cloud/src/app/env.ts`

## Acceptance criteria

- [x] Tests can exercise the adapter through a fake HTTP transport without production credentials.
- [x] Timeouts and rate limits do not cause fast retry loops or an unbounded request backlog.
- [x] Missing credentials in disabled mode require no provider calls; paused work is not reported as delivered.
- [x] Unknown company-create outcomes are surfaced for recovery instead of blindly issuing another create.

## Verification in this commit

- HTTP behavior tests for status classification, timeout, cancellation, shared quota, identity conflicts, and email opt-outs.
- Use an isolated Brevo account to confirm contact identifiers, company fields/lookup, and ambiguous-create recovery when credentials are available.
- Inspect logs to ensure they contain no contact payloads or credentials.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.

## Implementation evidence

- Added a cloud-only adapter, inert startup configuration, and atomic account-wide
  PostgreSQL quota state. Contact/general budgets use DB time and shared cooldowns;
  denied permits return durable deferral information without waiting or extending
  the denial. No consumer, worker, migration or production activation is included.
- Typed sanitized outcomes include disabled, paused, transient, rate-limited,
  permanent, identity conflict, not found and ambiguous create. Requests have bounded
  transport/body deadlines, cancellation and response size. Non-idempotent creates
  are never automatically retried. Accepted IDs survive later cooldown failures.
- Everr-owned field mappings and explicit association operations preserve unrelated
  provider fields. New contacts are suppressed without lists/automations, updates
  never force merges or write false opt-outs, and email changes include email
  suppression in the same request. See the [adapter contract](../../../../packages/cloud/src/crm/brevo/README.md).
- Real isolated-provider proof confirmed stable Contact `ext_id` and generated ID
  through name/email changes, email blocklisting true before and after the change,
  and safe blocking of a duplicate-email update without merging. Email-only fixture
  SMS blocklisting was false both before and after; true SMS opt-out preservation
  is covered by fake transport, not claimed as a phone-based provider proof.
- Required contact fields were created with their declared types. Company labels
  `EVERR_*` map to lower-case internal names, including `everr_org_id`. Two actual
  company POSTs produced two owned fixtures. A successful second response was
  deliberately lost locally; unfiltered bounded inventory recovered the second
  generated ID without a third POST. The attempted custom-attribute filter returned
  both fixtures and is not used for recovery. Empty, duplicated and full-page
  recovery results remain blocked instead of authorizing another create.
- Provider company PATCH returned 204 despite documented 200. Both validated success
  variants are supported. A renamed company's GET readback retained its external ID
  and verified Plan `pro`, app access `suspended` and subscription `past_due` as
  distinct attributes. Explicit link/unlink PATCHes succeeded, and subsequent GETs
  confirmed association addition and removal under the same 36-second request spacing.
- All owned fixture contacts/companies from exploratory and final proof runs were
  deleted successfully. Required Everr-only custom field definitions remain in the
  authorized isolated account. No preexisting contact was modified, no list or
  automation subscription was added, and no communication was sent. A final paced
  aggregate read returned HTTP 200 with zero companies and one contact, matching
  the account's preflight baseline; evidence is
  `/private/tmp/everr-brevo-06-cleanup-proof.json`.
- Final local verification: 42 tests passed across adapter/config/budget and task 05
  projection regression tests. App and cloud TypeScript, scoped lint, scoped formatting,
  whitespace and dead-code analysis passed (zero Fallow issues). Evidence is retained
  outside the repository in `/private/tmp/everr-task06-tests.log`,
  `/private/tmp/everr-task06-cloud-types.log`, `/private/tmp/everr-task06-app-types.log`,
  `/private/tmp/everr-task06-lint.log`, and `/private/tmp/everr-task06-fallow.json`.
  Sanitized provider fixture records are `/private/tmp/everr-brevo-06-contact-recovery-proof.json`
  and `/private/tmp/everr-brevo-06-fixtures.json`. They contain owned record IDs and
  outcomes, never credentials or provider contact payloads.
- No new telemetry is emitted. Earlier publisher ingestion evidence is unchanged.
  No UI changed and the main-worktree `.auth` is absent, so manual authenticated
  app checks are skipped. Source/schema changes do not generate or apply migrations.

## Independent review evidence

- Standards review found no material repository-standard violations. Spec review
  found and fixed two response-handling gaps: early malformed/definitive responses
  skipped exhausted-quota cooldowns, and a stalled response body was not explicitly
  cancelled when the deadline or caller aborted the request. Shared cooldowns now
  cover those paths, and cancellation releases the body stream. Known rejections
  retain their sanitized status if cooldown persistence fails or stalls; accepted
  create IDs remain available after later quota-storage failures.
- Regression checks reproduced both gaps before the fixes. All 53 tests across
  adapter/config/budget and task 05 projection regression tests passed after fixes.
  Evidence: `/private/tmp/task06-review-red.log` and
  `/private/tmp/task06-review-tests.log`. Cloud TypeScript, scoped lint, formatting,
  whitespace and dead-code checks passed (zero Fallow issues); logs are
  `/private/tmp/task06-review-cloud-types.log`, `/private/tmp/task06-review-lint.log`,
  `/private/tmp/task06-review-style.log` and `/private/tmp/task06-review-fallow.json`.
- Review covered cloud ownership, inert validated startup, identity/field ownership,
  suppression, conflict blocking, ambiguous-create recovery, response bounds and
  shared DB permits. The earlier isolated-provider proof remains applicable to these
  local response-handling fixes. No additional provider writes, workers, listeners,
  migration artifacts, telemetry or production activation were introduced.
- Durable create-attempt guards and cross-replica entity serialization remain
  explicit requirements of tasks 07 and 08. Bounded inventory recovery remains
  blocked for missing, duplicate or truncated results. This reviewed task is ready
  for the coordinating agent's separate scoped commit.
