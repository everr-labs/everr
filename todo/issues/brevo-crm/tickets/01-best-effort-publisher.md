# 01: Add the typed fire-and-forget publisher

Status: implemented, independently reviewed, and committed as `c4dca85c1`.

Repository: `everr`.

Depends on: [00: Record the agreed integration plan](00-planning-baseline.md).

Suggested commit: `feat(events): add best-effort business event publication`.

Design: [Brevo CRM integration plan](../../../../docs/brevo-crm-integration-plan.md).
Index: [commit sequence](../README.md).

## Scope of this commit

- Implement the typed event envelope and a small `events.publish(event): void` interface, with injected static subscribers and a no-subscriber implementation. Producers pass already available source facts; construct fallible envelope metadata and validate inside the publisher.
- Contain payload validation, synchronous subscriber exceptions and asynchronous rejections. Isolate subscribers and bound in-flight work.
- Add bounded shutdown drain and non-throwing log/counter diagnostics from the first implementation. Keep event/entity IDs out of metric dimensions.
- Add composition contracts and empty registrations in both applications. No CRM-specific types or dependencies enter shared code.

## Expected locations

These are starting points, not permission to rewrite unrelated modules.

- `packages/app/src/server/events/`
- `packages/app/src/composition/`
- `packages/app/src/app/composition/`
- `packages/cloud/src/app/composition/`
- `packages/app/src/server/shutdown.ts`

## Acceptance criteria

- [x] `events.publish(event)` returns without waiting for a subscriber and never propagates publication errors; source mutations call it only after commit.
- [x] A failed subscriber does not prevent another subscriber from running.
- [x] An empty registry creates no jobs; no UnitOfWork, outbox, or generic event tables are introduced.
- [x] Shutdown and overload have finite behavior and preserve the main operation.

## Verification in this commit

- Behavioral tests with deferred/rejected subscribers, synchronous throws, diagnostic failure, saturation, and shutdown.
- Typecheck both application compositions and verify their import ownership.
- Force a publication failure and verify the error diagnostic is ingested through Everr.

## Implementation evidence

Implemented against task 00 commit `8a9145de2`. The domain-facing interface is
`publish(fact): void`; both app compositions contain empty definitions and
subscribers, so this increment enables no source hooks, jobs, or CRM effects.
Production feature definitions and mutation coverage belong to tickets 02 onward.
The source-success/failure behavioral test exercises an already-completed source
operation double, not a newly wired User database mutation.

Verification on October 23, 2026:

- The focused publisher, diagnostic, shutdown, and existing worker test suite
  passed (43 tests across 9 files). It covers deferred/rejected subscribers, sibling attempts, source
  success/failure, schema/metadata failure, broken diagnostics, overload capacity
  recovery, bounded shutdown, late rejection, empty registration, routing, and
  static-registration errors. A type-contract check verifies feature payloads.
- App and cloud TypeScript checks pass. Cloud typechecking includes the shared
  test files. Scoped lint checks enforce type-only composition and public package
  ownership, with no cloud imports in shared contracts or the runtime.
- An isolated CLI collector received the real OTel diagnostic from the new
  publisher. Everr SQL found exactly one ERROR log at
  `2026-10-23 15:11:33.292 UTC`, service
  `everr-business-events-verification`, event
  `task01-0f6be2c4-86d2-4aa3-8d75-1c23f06c9aee`, subscriber
  `verification-consumer`, stage `subscriber`, exception type `Error`, message
  `Task 01 forced enqueue rejection`, and a 504-character stack trace.
- `everr.business_events.publication.failures` arrived with unit `1`, value `1`,
  and only `everr.business_event.type`, `everr.business_event.subscriber`, and
  `everr.business_event.failure_stage`. Force-flush and shutdown exported two
  cumulative snapshots at value `1`; the in-memory delta check verifies one
  increment. Log keys were discovered before the detail query. Evidence is kept
  locally under `.verify-everr/artifacts/task01-business-events/cli/`, which is
  ignored by Git.
- The helper used throwaway directories and ports 58238 through 58240. It runs the
  existing debug CLI/collector binary, unchanged by this ticket. The helper's
  Linux PID discovery is unavailable on macOS; cleanup additionally verifies
  these three ports directly. No default local stack was touched.
- `.auth` is absent in the main worktree and no UI behavior changed, so the
  authenticated manual app check is skipped per AGENTS.md. No production build,
  production ingestion, external CRM calls, or migrations are claimed.

Scoped files:

- `packages/app/src/composition/events.ts`, `index.ts`, `runtime.ts`
- `packages/app/src/server/events/{publisher,registration,telemetry,runtime}.ts`
- `packages/app/src/server/events/{publisher,telemetry}.test.ts`
- `packages/app/src/server/shutdown.ts` and `shutdown.test.ts`
- Both `packages/{app,cloud}/src/app/composition/runtime.ts` adapters
- `packages/app/package.json` public server exports and `packages/app/README.md`
- `docs/background-work.md`, `docs/brevo-crm-integration-plan.md`, task index,
  task 00 commit record, and this ticket

## Independent review and fixes

The separate review-and-fixes agent reviewed the scoped tracked and new files
against task 00's plan, this ticket, AGENTS.md, composition ownership, and the
repository's documented standards on October 23, 2026.

- Standards: no remaining material findings. Shared contracts stay type-only and
  have no cloud or CRM dependency. No database schema or source hooks were added.
- Specification: fixed subscriber adaptation passing the full envelope into a
  feature's fact parser. Strict schemas rejected the added `id` and `occurredAt`
  fields after successful publication validation. The adapter now removes those
  metadata fields before parsing, then restores the original envelope metadata.
  A strict-schema regression confirms delivery succeeds without a diagnostic.
- Clarified the existing feature seam, `EventPublisher<FeatureFact>`, and payload
  ownership. Feature parsers must leave input unchanged and return independent
  payload values, as Zod object schemas do. The envelope is shallow-frozen;
  general deep cloning or arbitrary subscriber mutation isolation is not claimed.
- Review verification: 17 tests passed across publisher, diagnostics, and shutdown
  after the fix; app and cloud TypeScript checks, scoped lint, formatting of all
  20 scoped files, and whitespace checks passed. The
  implementation's earlier 43-test worker-inclusive run remains recorded above.
- Diagnostic implementation and attributes did not change during review. The
  isolated Everr log/counter proof above therefore remains applicable. `.auth`
  remains absent, so no authenticated UI check is claimed.

Implementation and independent review are complete. The coordinating agent
committed the scoped change as `c4dca85c1`; the reviewer made no commit.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
