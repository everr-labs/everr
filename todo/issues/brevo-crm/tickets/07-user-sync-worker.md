# 07: Synchronize Users through a cloud integration runner

Status: implemented and independently reviewed, with retry-budget findings fixed
and focused checks plus isolated telemetry proof passed. Not committed.

Repository: `everr`.

Depends on: [02: Publish committed User lifecycle facts](02-user-events.md), [06: Implement the Brevo HTTP adapter and request budgets](06-brevo-http-adapter.md).

Suggested commit: `feat(crm): synchronize users through cloud worker handlers`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Implement the User/contact projection handler, reading latest state and updating only changed Everr-owned fields.
- Add independent best-effort Graphile enqueue as a cloud subscriber to User create/update/verification facts.
- Register a cloud integration runner through ApplicationRuntime.registerWorkers with its own execution capacity.
- Add persisted retry, pause, task payload validation, per-entity coordination across replicas, and synchronization diagnostics.
- Keep integration disabled by default until the rollout prerequisites in the task index are met.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/cloud/src/crm/`
- `packages/cloud/src/app/composition/runtime.ts`
- `packages/cloud/src/app/composition/identity.ts`
- `packages/cloud/src/worker-runtime.test.ts`

## Acceptance criteria

- [x] A User event produces a persisted consumer job only in cloud; the worker syncs the latest User.
- [x] Publication failure is measured but never changes auth success.
- [x] Delayed/concurrent jobs cannot regress a newer email or recreate an already deleted User.
- [x] CRM failures do not consume the reserved provisioning capacity or product alert slots.

## Verification in this commit

- Behavioral worker tests for delayed state, concurrent updates, rejected enqueue, payload validation, pause, retry, and shutdown.
- Run both composition/build ownership checks and manual auth flow where .auth is available.
- Verify forced enqueue failure and successful retry diagnostics through Everr.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.

## Implementation evidence

- Cloud registers ID-only User create/update/verification commands in configured or
  paused modes. Disabled mode and self-hosted register no CRM consumer. Paused mode
  keeps pending jobs without starting a CRM runner.
- The managed integration runner has one execution slot and its own pool. Fixed 64
  Graphile queue partitions serialize the entire source/HTTP/outcome sequence across
  replicas. Source rechecks, store tombstones and retained mappings prevent stale
  acknowledgements and missing-source creation. Task 09 still owns full deletion
  cleanup, including the unavoidable already-started HTTP/deletion race.
- Provider deferrals preserve the persisted failure budget and honor `retryAt`.
  Successors persist before acknowledgement. Native Graphile retries protect
  infrastructure/continuation-insertion failure; blocked/exhausted jobs remain
  inspectable using Graphile public APIs. Errors passed to Graphile are sanitized.
- 75 focused/regression checks passed across 7 files, including actual PostgreSQL
  and Graphile, two independent runners, current email, deleted/tombstoned sources,
  real auth success on cloud enqueue rejection, malformed payloads, pause/quota
  budgets, exhaustion and failed successor insertion followed by native retry.
  A final 18 checks across 2 files passed after the shared auth test helper and
  startup-isolation changes. Both app/cloud typechecks, scoped lint and Fallow's
  dead-code/import/ownership checks passed.
- Actual Better Auth signup persisted both User and account despite forced cloud
  consumer rejection. Isolated Everr ingested one enqueue exception for marker
  `task07-b8bbf282-4344-4655-acd6-efe0028ff9c9`, plus retry and synchronized logs for
  its `-retry` event at 17:02:52 and 17:03:52 UTC on October 23, 2026. The worker honored
  the adapter's full 60-second backoff. Bounded counters (unit 1) and lag histogram
  were ingested. Evidence: `.verify-everr/artifacts/task07-user-sync/`.
- No real provider changes, production activation or application migration changes.
  `.auth` is absent, so manual authenticated app checks were skipped. The isolated
  collector and disposable PostgreSQL container were stopped and their ports closed.

The coordinating agent must record separate review/fixes and commit evidence before
advancing to task 08.

## Independent review and fixes

- Standards: no remaining material violations. Cloud-only ownership, shared/self-hosted
  isolation, telemetry attributes, cancellation and managed lifecycle were checked.
- Specification: fixed a payload-only retry gap. If continuation insertion failed
  after HTTP, native Graphile retry could reuse an earlier failure count. The
  projection now durably reserves an allowance before HTTP and refunds known
  quota/pause/cancellation deferrals. Eight allowances bound each desired revision;
  unknown execution after a crash conservatively spends allowance even if no HTTP
  reached the provider. Success/new desired state reset it. Revision-tagged
  continuations cannot exhaust a newer snapshot's fresh allowance.
- Independently passed 73 targeted tests across five cloud files, including 13 real
  PostgreSQL/Graphile checks. The new near-exhaustion check proves failed successor
  insertion followed by native retry makes no additional HTTP request. Store checks
  cover stale counts, stale revisions, refunds and resets after success. Changed
  desired state accepts an exhausted older continuation with a fresh budget.
- Both app/cloud TypeScript checks, scoped lint, 22-file formatting and whitespace
  checks passed independently. The disposable review PostgreSQL container was
  stopped and removed; port 55438 has no listener.
- No generated/applied application migration or provider changes. The source schema
  includes the durable reservation column; rollout must prepare it with the rest of
  the CRM schema. Existing Everr ingestion evidence remains applicable because the
  diagnostic instruments, dimensions and failure-isolation boundary are unchanged.
