# 01: Add the typed fire-and-forget publisher

Status: planned. This ticket is not implemented.

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

- `packages/app/src/server/business-events/`
- `packages/app/src/composition/`
- `packages/app/src/app/composition/`
- `packages/cloud/src/app/composition/`
- `packages/app/src/server/shutdown.ts`

## Acceptance criteria

- [ ] `events.publish(event)` returns without waiting for a subscriber and never propagates publication errors; source mutations call it only after commit.
- [ ] A failed subscriber does not prevent another subscriber from running.
- [ ] An empty registry creates no jobs; no UnitOfWork, outbox, or generic event tables are introduced.
- [ ] Shutdown and overload have finite behavior and preserve the main operation.

## Verification in this commit

- Behavioral tests with deferred/rejected subscribers, synchronous throws, diagnostic failure, saturation, and shutdown.
- Typecheck both application compositions and verify their import ownership.
- Force a publication failure and verify the error diagnostic is ingested through Everr.

## Commit boundary

Prepare the implementation, its meaningful behavioral tests, and the
supporting documentation for a separate review-and-fixes agent. Preserve
unrelated work and keep the tree buildable after this ticket's prerequisites.
The coordinating agent stages only this ticket's reviewed files and commits
when its acceptance criteria and checks are satisfied. Record implementation,
independent review, and commit status separately and truthfully.
