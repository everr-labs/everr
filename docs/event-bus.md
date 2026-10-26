# Internal event bus

This guide describes the business-event bus implemented in the application. It
is internal engineering documentation. The bus distributes committed facts to
ancillary consumers; Graphile Worker executes their durable commands. A fact
describes something that happened, while a command asks a handler to do work.

## Ownership and entry points

| Responsibility                                    | Entry point                                          |
| ------------------------------------------------- | ---------------------------------------------------- |
| Producer, definition and subscriber contracts     | `packages/app/src/composition/events.ts`             |
| Typed registration helper                         | `packages/app/src/server/events/registration.ts`     |
| Routing, validation, isolation and draining       | `packages/app/src/server/events/publisher.ts`        |
| Process-local publisher and shutdown registration | `packages/app/src/server/events/runtime.ts`          |
| Guard for injected publisher implementations      | `packages/app/src/server/events/safe-publication.ts` |
| Self-hosted subscriber selection                  | `packages/app/src/app/composition/runtime.ts`        |
| Cloud subscriber and worker selection             | `packages/cloud/src/app/composition/runtime.ts`      |

Each feature owns its event types, schemas and publication boundary. Consumers
own their enqueue mapping, command schemas and worker handlers. The composition
selects registrations through `ApplicationRuntime.events` and separately selects
workers through `registerWorkers()`. Registering a subscriber does not start a
worker or allocate execution capacity. Shared app features depend on composition
contracts and never import the Cloud implementation.

Self-hosted and Cloud supply `events: []`. Producers are wired after their
source commits, and publication is inert until a composition selects a subscriber.

## Fact and envelope contracts

A producer supplies `type`, `version`, `subjectId`, `data`, and an optional
`actorId` where the feature schema permits it. `EventPublisher<FeatureEvent>`
restricts a feature to its own facts. The publisher adds a UUID `id` and an ISO
`occurredAt` timestamp. Subscribers receive `PublishedEvent<FeatureEvent>`.
`occurredAt` is publication time, not a database commit sequence or a customer
telemetry timestamp.

Definitions expose literal `type` and `version` values plus `parse(input)`.
Parsers validate fact-shaped input without publisher metadata, leave their input
unchanged, and return independently owned values. Zod object schemas provide
that behavior. The publisher routes by the exact `(type, version)` pair and
validates the fact before scheduling any subscriber.

All events in the catalog below currently use version `1`. Payloads contain
stable IDs and small facts, with no names, emails, credentials or database-row
copies. Treat facts as immutable. The publisher clones the validated snapshot
with `structuredClone` separately for each subscriber and freezes its envelope;
nested values are not recursively frozen, but sibling deliveries are isolated.

## Emitted-event catalog

The following are domain facts emitted through this bus. Graphile execution
events, diagnostic logs, alert journal records, and administrative commands such
as `crm.reconciliation.requested` are separate contracts.

| Event type                     | Subject           | `data` fields                                                            | Publication boundary                                                                                      |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `identity.user.created`        | User ID           | `userId`, `emailVerified` (boolean)                                      | Persisted User creation, including signup/OAuth and installation setup, after commit                      |
| `identity.user.updated`        | User ID           | `userId`                                                                 | Persisted User update after commit                                                                        |
| `identity.email.verified`      | User ID           | `userId`                                                                 | Persisted verification transition from false to true; also emits `identity.user.updated`                  |
| `identity.user.deleted`        | User ID           | `userId`                                                                 | User deletion after commit; requires consumer cleanup of the parent and its associations                  |
| `organization.created`         | Organization ID   | `organizationId`                                                         | Persisted Organization creation, including installation setup, after commit                               |
| `organization.updated`         | Organization ID   | `organizationId`                                                         | Persisted Organization update or onboarding update after commit                                           |
| `organization.deleted`         | Organization ID   | `organizationId`                                                         | Organization deletion after commit; requires consumer cleanup of the parent and its associations          |
| `membership.added`             | Membership row ID | `membershipId`, `organizationId`, `userId`                               | Persisted Membership creation, including invitation acceptance, installation setup and Cloud owner repair |
| `membership.updated`           | Membership row ID | `membershipId`, `organizationId`, `userId`                               | Persisted Membership update, including role updates, after commit                                         |
| `membership.removed`           | Membership row ID | `membershipId`, `organizationId`, `userId`                               | Explicit Membership deletion or Cloud downgrade removal, with IDs captured before deletion                |
| `billing.subscription.changed` | Organization ID   | `organizationId`, `subscriptionId`                                       | Cloud accepts and commits a newer provider subscription revision                                          |
| `organization.plan.changed`    | Organization ID   | `organizationId`, `previousPlan`, `plan` (each Plan is `hobby` or `pro`) | Actual stored Hobby-to-Pro or Pro-to-Hobby transition after commit                                        |
| `organization.provisioned`     | Organization ID   | `organizationId`                                                         | Guarded Cloud provisioning update transitions a row from pending to ready                                 |

The authoritative definitions are:

- [Identity, Organization and Membership](../packages/app/src/identity/events.ts).
- [Billing and Plan](../packages/cloud/src/billing/events.ts).
- [Provisioning readiness](../packages/app/src/organizations/events.ts).

Creating an already verified User emits `identity.user.created` with
`emailVerified: true`, without inventing a later verification transition. The
update facts signal persisted updates; they do not carry field diffs. An inactive
Pro subscription can suspend access without changing Plan. Provisioning readiness
does not imply activation.

Membership subjects identify persisted relationship rows. A consumer projecting
relationships can use the stable User/Organization pair. One User can belong to several
Organizations. Database cascades do not fabricate individual removal facts.
Consumers of parent deletion must use the parent ID and their retained mappings
after source rows disappear. Better Auth also explicitly deletes Memberships
before deleting an Organization; those actual deletes publish captured facts.

## Publication, durability and shutdown

A producer publishes only after its source transaction or standalone mutation
succeeds. Shared identity uses `identityLifecycleAdapter` to collect facts inside
the real root transaction and publish after it resolves. Better Auth 1.6.33 also
runs queued database after-hooks following rollback, so those hooks alone do not
prove commit success. Provider billing and provisioning wrappers stay inside the
actual source transaction. If Organization creation commits separately from its
creator Membership, a later Membership failure does not undo the Organization fact.

`events.publish(fact)` returns `void`. It schedules independent subscriber
`enqueue` calls in microtasks and does not await Graphile persistence or provider
I/O. A throw or rejected promise from one subscriber does not prevent siblings
from running or change the committed source result. `safeEventPublisher` provides
the same containment for injected publisher implementations at producer seams.

The publisher keeps at most 128 publications in flight. Excess work is dropped
with diagnostics. There is no outbox, durable event history, replay service,
subscriber retry loop or global event-ordering guarantee. Crashes can lose facts
between source commit and consumer admission. Consumers must tolerate duplicates
and changing source state. Consumers that require repair must own a current-state
reconciliation path; the bus cannot reconstruct historical events.

Durability starts when a subscriber successfully persists its own Graphile job.
Command validation is separate from fact validation. Worker retries, job-key
coalescing, revision guards and idempotency belong to that consumer. A job key
coalesces pending work; it does not provide exactly-once external effects.
Critical work that must commit with source state uses
`addWorkerJobInTransaction` or `addWorkerJobUsing(tx, ...)` inside that transaction,
as described in [background work](background-work.md#durability-transactions-and-replay).

Shutdown closes publication admission and waits at most five seconds for accepted enqueues. Workers stop next,
followed by telemetry flushing. A timed-out enqueue can settle later and still has
rejection handling. Hard termination can lose facts and diagnostics. HMR disposal
also closes the old publisher.

## Adding a subscriber and its worker handler

1. Use the owning feature's exported definition. Keep the subscriber in the
   consuming module, alongside its commands, rather than adding consumer knowledge
   to the producer or publisher. `eventRegistration(definition, ...subscribers)`
   infers the validated payload from that definition. Subscriber IDs must be
   nonempty, static and unique across the entire application registration list.
2. Map the fact into a small, independently versioned command. Preserve the event
   ID/type/time when useful for correlation, validate subject/payload identity,
   and validate the command before enqueueing. Enqueue through the shared public
   worker helper and propagate its failure so publication diagnostics can record
   it. Keep HTTP calls and long-running work in the task handler.
3. Register subscribers in the application's `ApplicationRuntime.events`.
   Multiple consumers of one definition can share a registration or use separate
   registrations with that same definition object. Reuse the exported definition;
   a different definition object for the same type/version is rejected at startup.
4. Add the task to a feature-owned task list and register it with an appropriate
   supervised runner. Check its capacity and latency needs. The reserved Cloud
   provisioning runner must retain its isolation. Validate persisted payloads
   before effects, load current state, and own retry/idempotency and deletion policy.

For example, a new consumer can register against an existing User definition:

```ts
import { eventRegistration } from "@everr/app/server/events/registration";
import { userEventDefinitions } from "@everr/app/identity/events";
import { addWorkerJob } from "@everr/app/server/worker/jobs";
import { z } from "zod";

const command = z.object({ version: z.literal(1), userId: z.string().min(1) }).strict();
const registration = eventRegistration(userEventDefinitions[0], {
  id: "example.user-projection",
  async enqueue(event) {
    const payload = command.parse({ version: 1, userId: event.data.userId });
    await addWorkerJob("example/sync-user", payload, {
      jobKey: `example:user:${payload.userId}`,
    });
  },
});
```

The names above are illustrative, not registered tasks. Add the registration to
the consuming application's `events` list and provide its matching worker task.
That task validates the persisted command, reads the current User, and owns the
projection's upsert/deletion and retry behavior. No change to the publisher is
needed. Test enqueue rejection and source deletion as well as successful admission.

## Adding an event or producer

Define a literal type/version and strict payload schema in the owning feature's
`events.ts`, export its TypeScript type and `EventDefinition`, and add it to the
catalog above. Carry only the facts a consumer cannot reliably infer later; avoid
full rows and contact profiles. Do not fabricate an actor when the operation has
no User. Keep readiness, Plan, access and activation distinct.

Inject `EventPublisher<FeatureEvent>` at the producer boundary and normalize that
port once with `safeEventPublisher(publisher, featureDefinitions)`. Call
`events.publish(fact)` directly after the successful outermost commit. Capture
IDs needed for removals before deletion. Never await ancillary publication,
publish before commit, or broaden a catch around the source operation merely to
contain publisher failure. Registration and schema errors remain startup errors.

For an incompatible payload, define an explicit new version and account for any
consumer jobs already persisted under the old command format. Event versions and
worker-command versions are independent contracts. Update the catalog and tests
with the final supported behavior.

## Diagnostics and verification

The existing server OTel providers emit `business_events.publication.failed` and
`everr.business_events.publication.failures` (counter, unit `1`), under meter
`everr-app.business-events`. Stages are `publication` (injected port failure),
`validation`, `envelope`, `subscriber`, `overload`, `closed`, and `drain`. Metrics
use only bounded event type, static subscriber ID and stage under
`everr.business_event.*`. Event/subject IDs and exception attributes belong on
logs. Validation failures are redacted. Consumers must keep profile data, SQL,
secrets and provider bodies out of thrown messages. Logger and counter failures
are independently contained.

`publisher.test.ts` covers routing, validation, isolation, capacity and draining;
`safe-publication.test.ts` covers injected-port failures. Identity integration
tests cover real producer commit/rollback boundaries. Consumer tests should prove
the fact-to-command mapping, registration, enqueue rejection, persisted payload
validation, current-state behavior, retries and deletion. Use a real disposable
PostgreSQL database for transaction and concurrency guarantees. For telemetry
changes, exercise diagnostics and verify actual ingestion through Everr in the
intended installation; passing exporter tests alone is insufficient.
