# Error triage state is append-only telemetry, not a database row

Investigations, Resolutions, and Status changes on an Error are stored as append-only log events in the existing logs tables (cloud `app.logs`, local Collector), keyed by `(tenant, fingerprint)` with `everr.error.*` attributes and the markdown body in the log Body. There is no `errors` table anywhere: not in Postgres, not as a dedicated ClickHouse table. An Error's status is derived at read time (latest status event wins), and everything an Agent or User writes about an Error is itself telemetry, readable through the same query surfaces (`everr local query` / `everr cloud query`, MCP `query`) as any other Signal. Every comparable product (Sentry, and the like) keeps triage state in a mutable store; we deliberately don't, because in Everr the Agent is a first-class consumer of telemetry, and triage state stored as telemetry is automatically visible to it with zero new read surface.

## Considered options

- **Postgres `errors` row, materialized on first touch.** A mutable row per touched Error (status column, snapshot of fingerprint inputs for re-linking if the fingerprint algorithm changes). Conventional and edit-friendly, but it splits Error state across two stores, needs new read paths for agents, and introduces the sync question of when rows materialize.
- **Dedicated ClickHouse table + logs projection** (the `app.alert_events` pattern). Typed columns for the UI plus a logs surface for agents. Rejected as unnecessary schema: the event shapes here are simple enough that log attributes cover them.
- **Plain log events** (chosen). Zero new schema, one write path (a generic log emitter with a cloud REST backend and a local OTLP backend), symmetric across both surfaces.

## Consequences

- **Nothing is editable or deletable.** A wrong Investigation is corrected by appending another one; a status change is a new event. This is the event-sourcing trade accepted on purpose.
- **Triage state expires with log retention.** Status events live under the same TTL as other logs. A Resolution older than the retention window disappears, and the Error (if still occurring) reads as open again. Accepted: an Error with no Occurrences inside the retention window isn't listed anyway.
- **State is keyed by raw fingerprint.** A change to the fingerprint normalization algorithm orphans attached events silently; there is no snapshot to re-link with. Accepted to keep the schema at zero.
- **Status is computed in the list query.** The errors summary SQL joins status events and applies the regression rule (an Occurrence reopens a resolved Error iff its `service.version` was first seen after the Resolution; versionless Occurrences compare their own timestamp against the Resolution's). This makes the list query heavier; it cannot rely on an indexed status column.
- **Derived fingerprints are not globally unique.** `cityHash64(service, type, message)` can collide across Organizations, so every event carries and is filtered by tenant; the row-level tenant policy is load-bearing for correctness, not just isolation.
