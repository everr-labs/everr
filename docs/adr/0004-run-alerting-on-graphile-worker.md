# Run alerting on Graphile Worker

Everr runs Alert evaluation and notification delivery as Graphile Worker jobs in the shared application plane. PostgreSQL is the durable system of record and job queue, while ClickHouse remains the read-only query target. This replaces the separate Clickety-clack service and its Redis hot path, reducing the Cloud deployment to infrastructure Everr already operates.

## Considered options

- Keep Clickety-clack and replace Redis with custom PostgreSQL queues and leases: rejected because it recreates scheduling, locking, retry, and wake-up behavior already provided by Graphile Worker.
- Use Graphile Worker only to call the Rust service: rejected because it keeps two runtimes and retry systems while weakening transactional ownership.
- Use Alertmanager: rejected because Everr owns multitenant routing, grouping, silencing, inhibition, and delivery semantics directly.

## Consequences

- Graphile Worker owns execution, retries, delayed scheduling, and worker distribution. Alert tables retain the durable domain state and idempotency records.
- Preview-owned Alert definitions, SLO definitions, and event history reference the Preview directly and are deleted by PostgreSQL cascades. Their foreign keys include the Organization identity, so the database rejects cross-Organization ownership. Cleanup does not require a remote-engine retry ledger or orphan sweep.
- Alert and SLO ownership is stored in a required first-class `repoid` column. Live resources carry `previewId: null`; preview resources carry their parent Preview id, and the database verifies that their Organization and Repoid match the Preview.
- Alert events retain an immutable source kind and source definition id instead of a live foreign key. Deleting a rule does not rewrite historical identity.
- Notification groups, deliveries, and their event memberships are normalized. Delivery history is derived from successful delivery records, so one route cannot overwrite another route's targets.
- The application uses one native alerting model. There is no empty-string namespace sentinel, ownership annotation, or compatibility facade for the retired service.
- Alert jobs carry a Tenant identity, but ClickHouse placement and credentials are always resolved server-side from the Tenant.
- The worker pool is shared across Organizations. Fairness and ClickHouse query concurrency are enforced by Everr rather than by creating one queue or process per Organization.
- Alerting now shares PostgreSQL's availability and capacity envelope. Queue lag, table growth, and noisy-neighbor behavior must be monitored explicitly.
