## Migrate Ingress + CDEvents Into `packages/app`

**Summary**
- Replace the standalone Go `ingress` and `cdevents` services with TypeScript server modules inside `packages/app`.
- Make the app the only GitHub webhook receiver at a fixed public route: `/webhook/github`.
- Start the queue worker runtime from `packages/app/src/start.ts`, but guarantee it boots after DB migrations by dynamically importing `start.ts` from server startup after migration completes.
- Preserve the current topic-based durable queue model only for `collector` and `cdevents`.
- Handle `installation` and `installation_repositories` events synchronously inside `/webhook/github`, outside the queue.
- Simplify cdevents storage to a single ClickHouse table, `app.cdevents`, with no `otel.cdevents_raw` staging table and no `otel -> app` materialized view layer.

**Interfaces**
- Public webhook endpoint: fixed `/webhook/github`.
- Do not expose a public/internal cdevents route; keep cdevents as a shared server handler invoked in-process by the worker.
- Do not keep a separate `/api/github/install-events` route in the final architecture; shared install-event logic should be invoked directly from `/webhook/github`.
- Remove the separate Go service interfaces and remove `/api/github/tenant-resolution`; tenant lookup becomes in-process.
- Keep existing queue/collector env names under `INGRESS_*` for worker behavior and collector replay, but remove `INGRESS_PATH`, `CDEVENTS_PATH`, and `INGRESS_TENANT_RESOLUTION_SECRET`.
- Add a dedicated cdevents write config for the app, separate from the read-only app ClickHouse client: `CDEVENTS_CLICKHOUSE_URL`, `CDEVENTS_CLICKHOUSE_USERNAME`, `CDEVENTS_CLICKHOUSE_PASSWORD`, `CDEVENTS_CLICKHOUSE_DATABASE`, `CDEVENTS_BATCH_SIZE`, `CDEVENTS_FLUSH_INTERVAL`, `CDEVENTS_FLUSH_RETRY_DELAY`.
- The cdevents writer must insert directly into `app.cdevents`; no raw-table indirection is retained.

**Implementation Changes**
- Add a server module area under `packages/app/src/server/github-events/` for:
  - topic routing
  - webhook enqueue handler
  - queue store
  - worker + cleanup loops
  - tenant resolution cache
  - collector replay
  - cdevents transform + buffered ClickHouse writer
  - shared install-event logic and cdevents handler
- In `packages/app/src/start.ts`, add a server-only singleton bootstrap guarded by `import.meta.env.SSR`, `NODE_ENV !== "test"`, and a `globalThis` runtime marker so dev HMR or repeated imports never start duplicate pollers.
- Keep `createStart(() => ...)` for request middleware only; do not start workers inside `getOptions()` because it runs per request.
- Use the shared `pg` pool for queue operations and keep queue reads/writes as raw SQL to preserve `FOR UPDATE SKIP LOCKED`, transactional enqueue, and finalize semantics. Add the queue table to `packages/app/src/db/schema.ts` for ownership, using a custom `bytea` mapping for `body`.
- Add a manual Drizzle migration under `packages/app/drizzle/` that creates or adopts the current `webhook_events` shape, including `topic`, `tenant_id`, the `(source, event_id, topic)` unique key, and the claim/dead indexes.
- Replace the current cdevents ClickHouse schema layer with a single owned table in `app.cdevents`; remove creation of `otel.cdevents_raw`, `app.cdevents_mv`, and any dependency on `clickhouse/init/11-create-cdevents-mvs.sql`.
- Public `/webhook/github` handler should validate the GitHub signature once, require `X-GitHub-Delivery`, compute `body_sha256`, and split behavior by event type:
  - `workflow_run` and `workflow_job`: enqueue one row per topic and return `202` on insert, `200` on duplicate with same hash, `409` on delivery-id hash mismatch
  - `installation` and `installation_repositories`: invoke shared install-event logic inline and return the direct handler result
- Worker dispatch should be limited to queued topics only:
  - `collector`: outbound HTTP POST to `INGRESS_COLLECTOR_URL`
  - `cdevents`: invoke the shared cdevents handler in-process without exposing a route
- Remove `topicApp`, installation event forwarding, and any worker dispatch path for app events.
- Remove the standalone `/api/github/install-events` route after its logic is extracted behind shared server helpers used by `/webhook/github`.
- Tenant resolution should be direct DB access with cache reuse and persisted `tenant_id` on the queue row for queued topics only; no self-call to an app route.
- Implement cdevents writes with a dedicated `@clickhouse/client` write client and the existing buffered flush/retry behavior, targeting `app.cdevents` directly.
- Update ClickHouse permissions so the dedicated cdevents writer has `INSERT` on `app.cdevents` while the existing app read client remains read-only on `app.*`.
- Remove Go `ingress/` and `cdevents/`, their Dockerfiles/tests, compose services, and old migration mounts once TS parity passes. Update README/devtunnel instructions to point GitHub webhooks at the app instead of port `3333`.

**Test Plan**
- Route tests for `/webhook/github`: bad method, bad signature, missing delivery id, ignored events, inserted, duplicate, conflict, multi-topic fanout for workflow events, and inline handling for installation events without enqueueing.
- Queue/store tests: transactional enqueue, per-topic uniqueness, claim ordering, lock handling, retry vs dead classification, cleanup retention, persist-tenant-once behavior, and no `app` topic rows.
- Dispatch tests: `collector` only replays collector, `cdevents` only hits the in-process cdevents handler, and failures stay isolated per topic row.
- Install-event tests: `installation` updates tenant installation status inline, `installation_repositories` remains a no-op if unchanged, and DB write failures surface directly instead of entering retry state.
- Removal tests: no remaining callers or route registration for `/api/github/install-events`.
- cdevents tests: supported workflow mappings, ignored unsupported events/actions, missing headers, malformed payloads, batching, timer flush, retry after transient ClickHouse failure, flush on close, and inserts landing directly in `app.cdevents`.
- Schema/infra tests: no `otel.cdevents_raw` table creation, no cdevents materialized view creation, and writer credentials limited to direct inserts on `app.cdevents`.
- Startup tests: bootstrap is SSR-only, skipped in tests, safe on repeated imports/HMR, and only one runtime starts per process.
- Verification commands: `pnpm --filter @everr/app typecheck`, `pnpm --filter @everr/app test`, and `pnpm --filter @everr/app build`.

**Assumptions**
- Collector stays external and continues to receive replayed webhooks over HTTP via `INGRESS_COLLECTOR_URL`.
- Fixed route paths are acceptable; env-configurable webhook paths are intentionally dropped.
- Installation events rely on direct synchronous DB handling and GitHub delivery retries rather than the internal queue.
- No internal cdevents HTTP route is exposed from the app; in-process invocation is the security boundary.
- `app.cdevents` is the sole persisted cdevents table after the migration; any old raw-table or MV setup is removed as part of the cutover.
- The app runs as a long-lived Node server, so one queue runtime per process is valid and multi-replica coordination relies on Postgres row locking.
- This is a full cutover: the Go `ingress` and `cdevents` implementations are deleted in the same change after the TypeScript replacement is covered by tests.
