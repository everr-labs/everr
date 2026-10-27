# Internal events and Graphile jobs

Application code calls `await events.publish(fact)` after committing a mutation.
The publisher finds the configured routes, validates the fact and calls
`addWorkerJob` directly. Graphile is the execution mechanism. There is no separate
in-memory bus, asynchronous subscriber interface or publication queue.

## Ownership and entry points

| Responsibility                           | Entry point                                     |
| ---------------------------------------- | ----------------------------------------------- |
| Event and Graphile route contracts       | `packages/app/src/composition/events.ts`        |
| Validation and direct Graphile admission | `packages/app/src/server/events/publisher.ts`   |
| Application publisher                    | `packages/app/src/server/events/runtime.ts`     |
| Self-hosted route selection              | `packages/app/src/app/composition/runtime.ts`   |
| Cloud routes and worker selection        | `packages/cloud/src/app/composition/runtime.ts` |

Features own their event schemas and commit boundaries. Application composition
selects `ApplicationRuntime.events`, a list of event-to-job routes. Each route
contains the feature definition and a synchronous `job(event)` function returning
`{ task, payload, spec }`. The spec uses Graphile's `TaskSpec` directly.
Handlers execute in ordinary Graphile task lists selected by `registerWorkers()`.
Producers know only `EventPublisher<FeatureEvent>`, never the handlers.

Self-hosted and Cloud currently configure no routes. Events without a matching
route, including unhandled versions, are ignored without a registration ceremony.

## Fact and envelope contracts

A producer supplies `type`, `version`, `subjectId`, `data`, and an optional
`actorId`. Feature schemas validate the fact before building a job. The publisher
adds a UUID `id` and an ISO `occurredAt` publication timestamp. Routes receive
`PublishedEvent<FeatureEvent>` and build the payload accepted by their task.

All events below use version `1`. Payloads contain stable IDs and small facts,
with no names, emails, credentials or database-row copies. A Graphile command
may coalesce events and read current state rather than preserve event history.

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
| `membership.updated`           | Membership row ID | `membershipId`, `organizationId`, `userId`, optional `previous`          | Persisted Membership update, including role updates, after commit                                         |
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

User update and delete operations publish one fact per affected row, including
bulk mutations and multi-row predicates. Verification facts describe only actual
false-to-true transitions. Targets are locked and the original predicate is
revalidated before writes, with publication deferred until root commit.

`membership.updated` carries the committed User/Organization endpoints. When either
endpoint changes, its `data.previous` contains the prior `userId` and
`organizationId`. Role-only updates omit `previous`. Consumers maintaining
associations must recheck both pairs against current state.

Membership subjects identify persisted relationship rows. A consumer projecting
relationships can use the stable User/Organization pair. One User can belong to several
Organizations. Database cascades do not fabricate individual removal facts.
Consumers of parent deletion must use the parent ID and their retained mappings
after source rows disappear. Better Auth also explicitly deletes Memberships
before deleting an Organization; those actual deletes publish captured facts.

## Publication and durability

Always await publication after the root transaction commits. Shared identity
collects facts inside the transaction and publishes after it resolves. Better
Auth 1.6.33 runs queued database after-hooks even following rollback, so those
hooks alone do not prove a successful commit.

`publish` resolves after Graphile admission has been attempted for each matching
route. It never runs the handler. Validation and enqueue failures are reported
without rejecting the publication or changing the committed source result.
Failure of one route does not prevent another route from being attempted.
The publisher implementation owns this guarantee; injected test publishers must
honor the same contract.

There is no publication capacity limit, background microtask queue, shutdown
drain, outbox or durable event history. A crash between source commit and
Graphile admission can still lose an event. Durability and retries begin once
Graphile persists the job. Job keys, queues, idempotency and reconciliation belong
to each consumer. Awaiting publication adds the enqueue latency to the caller.

Critical commands that must commit with source state use
`addWorkerJobInTransaction` or `addWorkerJobUsing(tx, ...)` inside that transaction.
See [background work](background-work.md#durability-transactions-and-replay).

## Adding an event handler

1. Define the fact and its schema in the owning feature. Publish it only after
   the actual source commit succeeds, then add it to the catalog above.
2. Implement a normal Graphile task and its payload schema. Keep provider calls
   and other handler work in that task, outside publication.
3. Add an `EventRoute<FeatureEvent>` mapping its definition to `{ task, payload,
   spec }`. `job(event)` only builds data. It must not perform I/O.
4. Select the route in `ApplicationRuntime.events` and the task's worker in
   `registerWorkers()`. Omit the route when the consumer is disabled.
5. Test routing to the correct Graphile task, payload validation, enqueue failure
   containment and the handler's retry/idempotency behavior. Do not add another
   dispatcher or a pluggable queue interface.

## Diagnostics

The publisher records `business_events.publication.failed` and increments
`everr.business_events.publication.failures`. Metric attributes use bounded event
types, route identities and failure stages. IDs and exceptions appear only in
logs. Fact schema errors are redacted before reporting. These diagnostics are
best effort and cannot change the source result.
