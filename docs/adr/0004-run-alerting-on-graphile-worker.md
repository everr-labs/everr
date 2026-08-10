# Run alerting on Graphile Worker

Everr runs Alert evaluation and notification delivery as Graphile Worker jobs in the shared application plane. PostgreSQL owns durable alert state, delivery coordination, and the job queue. ClickHouse is the rule query target and the immutable store for evaluation evidence and transition history. This replaces the separate Clickety-clack service and its Redis hot path, reducing the Cloud deployment to infrastructure Everr already operates.

## Considered options

- Keep Clickety-clack and replace Redis with custom PostgreSQL queues and leases: rejected because it recreates scheduling, locking, retry, and wake-up behavior already provided by Graphile Worker.
- Use Graphile Worker only to call the Rust service: rejected because it keeps two runtimes and retry systems while weakening transactional ownership.
- Use Alertmanager: rejected because Everr owns multitenant routing, grouping, silencing, inhibition, and delivery semantics directly.

## Consequences

- Graphile Worker owns execution, retries, delayed scheduling, and worker distribution. PostgreSQL alert tables retain current domain state, delivery outbox records, and evaluation idempotency markers.
- ClickHouse stores immutable evaluation samples, bounded query evidence, and instance transitions. The alert detail and triage history reads use this analytical history instead of PostgreSQL JSON rows.
- Preview-owned alert definitions and delivery outbox records reference the Preview directly and are deleted by PostgreSQL cascades. ClickHouse history keeps the Preview id and expires through the tenant logs retention policy.
- Alert ownership is stored in a required first-class `repoid` column. Live resources carry `previewId: null`; preview resources carry their parent Preview id, and the database verifies that their Organization and Repoid match the Preview.
- ClickHouse alert events retain the source definition id and resource name without a live foreign key. Deleting a rule does not rewrite historical identity.
- Notification groups, deliveries, and their event memberships are normalized. Delivery history is derived from successful delivery records, so one route cannot overwrite another route's targets.
- The application uses one native alerting model. There is no empty-string namespace sentinel, ownership annotation, or compatibility facade for the retired service.
- Alert jobs carry a Tenant identity, but ClickHouse placement and credentials are always resolved server-side from the Tenant.
- The worker pool is shared across Organizations. Fairness and ClickHouse query concurrency are enforced by Everr rather than by creating one queue or process per Organization.
- Alert scheduling and delivery share PostgreSQL's availability and capacity envelope. Historical evidence growth follows ClickHouse logs retention. Queue lag, table growth, and noisy-neighbor behavior must be monitored explicitly.
