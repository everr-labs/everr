# Alerting System Design

Date: 2026-06-06

## Summary

Everr will add a YAML-defined alerting system for free-form observability alerts. The v1 model avoids SLO/SLI terminology and uses a Grafana-style rule shape: users write a ClickHouse SQL query that returns violating rows. If the query returns at least one row, the alert is firing. If it returns zero rows, the alert resolves.

Alert definitions are managed only through YAML files. Users can test definitions locally through the Everr CLI against cloud data by default, or local telemetry with `--local`. Users can upload alert definitions through the CLI. Uploads store an explicit source URL and git-derived metadata when available, so the web app can link back to the definition.

Alert orchestration uses `pg-boss` with the existing Postgres database. Everr-owned alert tables remain the source of truth for schedules, state, events, and retention. `pg-boss` is used for distributed queueing, retries, and a small number of scanner jobs; Everr does not create one cron schedule per alert.

## Goals

- Support YAML-only alert definitions.
- Make alert rules simple to understand: a query returns bad rows, so the alert fires.
- Run orchestration with `pg-boss`.
- Use the existing Postgres database for queue persistence and app alert state.
- Retain Everr-owned alert state, events, and evidence for 7 days.
- Retain completed/failed alert queue jobs according to the same 7-day policy where `pg-boss` retention options apply.
- Test alert YAML from the CLI against cloud or local telemetry.
- Upload alert YAML from the CLI and validate SQL before activation.
- Store source metadata so web users can open the definition in the repository.
- Deliver v1 notifications to the desktop app, with popup behavior controlled by severity.

## Non-Goals

- No SLO, SLI, objective, error-budget, or burn-rate model in v1.
- No PromQL or SLOTH compatibility beyond loose inspiration from YAML-based declarations.
- No per-row alert instances in v1. A rule has one alert state even if it returns many rows.
- No local upload path.
- No standalone delete command in the first CLI scope. YAML upload deactivates rules omitted from the same uploaded source.
- No email, Slack, PagerDuty, or webhook notification targets in v1.
- No durable workflow engine in v1. Alert evaluation is a scheduled queue job plus app-owned state transitions.

## Current Project Context

The web app is `@everr/app`, built with TanStack Start, Vite, Drizzle, Postgres, and ClickHouse helpers. It already has:

- Drizzle schema and startup migrations in `packages/app/src/server.ts`.
- Existing Postgres connection helpers in `packages/app/src/db/client.ts`.
- Existing Postgres `LISTEN/NOTIFY` and SSE fanout for workflow updates.
- Existing CLI routes under `packages/app/src/routes/api/cli/*`.
- A Rust CLI in `packages/desktop-app/src-cli`.
- A Tauri desktop app that already consumes authenticated tenant SSE events and displays CI failure notifications.

The current GitHub event worker already uses `pg-boss`. Alerting should reuse that operational dependency instead of adding DBOS, Workflow SDK, Graphile Worker, Duroxide, Redis, or a new workflow runtime.

## pg-boss Orchestration

`pg-boss` is initialized from alert runtime startup code using the existing Postgres pool. The runtime configures:

- Existing Postgres connection through the `db.executeSql` adapter pattern already used by the GitHub event runtime.
- A queue for due-alert scans, for example `alert-scan`.
- A queue for alert evaluations, for example `alert-evaluate`.
- A dead-letter queue for terminal evaluation failures, for example `alert-dead-letter`.
- Queue-level retry, heartbeat, expiration, and retention options.
- Worker concurrency settings sized by deploy environment.

The alert runtime can run inside the long-lived TanStack Start server process because `pg-boss` is a normal Node queue library and is already compatible with the current app. The alert modules should still be factored so they can be started as a dedicated worker role later if production needs separate web and worker scaling.

### Scheduling Model

Everr does not create one recurring `pg-boss` cron schedule per alert. At 5,000 alerts per minute, thousands of independent cron schedules would be the wrong scaling shape in any of the evaluated runtimes.

Instead, Everr owns scheduling state in `alert_definitions`:

- `evaluation_interval_seconds`
- `next_evaluation_at`
- `schedule_jitter_seconds`
- `last_enqueued_at`

A single recurring `pg-boss` schedule runs the scanner every minute. The scanner:

1. Claims active due alerts from `alert_definitions` using a bounded query and Postgres row locking.
2. Advances `next_evaluation_at` according to each alert's `evaluationInterval` plus stable jitter.
3. Enqueues one `alert-evaluate` job per claimed alert with an evaluation timestamp.
4. Stops when it reaches its batch limit, allowing the next scanner tick or another scanner worker to claim more due alerts.

The scanner is safe with multiple app or worker replicas because Postgres row locks prevent the same due alert from being claimed twice in the same batch. The evaluation worker is also safe with multiple replicas because `pg-boss` uses Postgres job locking to distribute work.

### Scale And Backpressure

5,000 evaluations per minute is about 83 evaluations per second. The queue can handle this shape, but ClickHouse query cost is the real capacity limit.

Required ClickHouse concurrency is approximately:

```text
83 * average_query_seconds
```

The implementation must use explicit query concurrency controls:

- Global alert evaluation concurrency.
- Optional per-organization concurrency to avoid one org consuming the fleet.
- Worker `localConcurrency` sized with the number of app/worker replicas in mind.
- Bounded scanner batch size so a large due set does not create an unbounded queue spike.
- Stable schedule jitter so thousands of one-minute alerts do not all enqueue in the same second.

Alert evaluation remains at-least-once at the application level. Even if the queue claims a job once, retries, worker crashes, and deployment races require idempotent state transitions keyed by `(alert_definition_id, evaluation_scheduled_for)`.

References checked:

- https://github.com/timgit/pg-boss
- https://github.com/timgit/pg-boss/blob/master/docs/api/scheduling.md
- https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md
- https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md
- https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md
- https://worker.graphile.org/docs/performance
- https://workflow-sdk.dev/docs/deploying/world/postgres-world

## YAML Format

The YAML format is service-scoped and alert-focused.

```yaml
version: everr/v1
service: api
labels:
  team: platform

alerts:
  - name: high-5xx-routes
    severity: critical
    routing: admins
    evaluationInterval: 1m
    window: 5m
    summary: "{{ rows.length }} routes have elevated 5xxs in api"
    description: "Top route: {{ rows.0.route }} with {{ rows.0.error_count }} errors"
    query: |
      SELECT
        SpanAttributes['http.route'] AS route,
        countIf(StatusCode >= 500) AS error_count,
        count() AS request_count
      FROM traces
      WHERE Timestamp >= now() - INTERVAL {{ window }}
        AND ServiceName = 'api'
      GROUP BY route
      HAVING error_count >= 10
      ORDER BY error_count DESC
      LIMIT 20
```

Rules:

- `version` must be `everr/v1`.
- `service` is required and groups alert definitions.
- Alert identity is `(organization_id, service, name)`.
- Upload upserts by alert identity.
- `severity` is fixed to `critical` or `warning`.
- `critical` creates a desktop popup notification.
- `warning` records the alert and updates desktop/web lists without a popup.
- `routing` references exactly one routing-list slug.
- Built-in routing slugs are `everyone`, `admins`, and `owners`.
- `evaluationInterval` is required per alert.
- `evaluationInterval` must be at least `1m` in v1.
- `window` is required per alert.
- `query` must return only violating rows.
- A non-empty query result means firing.
- An empty query result means resolved.
- Returned rows are bounded evidence for the rule, not separate alert instances.
- `summary` is required.
- `description` is optional.
- `summary` and `description` can template alert metadata and returned rows.
- `{{ window }}` expands to a validated ClickHouse interval fragment such as `5 MINUTE`, so users write `INTERVAL {{ window }}`.

## CLI Flow

Add an `alerts` command group:

```bash
everr alerts test path/to/alerts.yaml
everr alerts test path/to/alerts.yaml --local
everr alerts upload path/to/alerts.yaml --source-url https://github.com/acme/api/blob/main/everr-alerts.yaml
```

`alerts test`:

- Defaults to cloud.
- Targets local telemetry with `--local`.
- Parses YAML.
- Validates schema, window formats, template syntax, and SQL substitution.
- Runs each alert query with its declared `window`.
- Prints whether each alert is currently firing.
- Prints bounded evidence rows.
- Does not persist alert state.
- Does not send notifications.

`alerts upload`:

- Requires authentication.
- Is allowed for any organization member.
- Uploads the raw YAML and parsed metadata.
- Requires `--source-url`; this is the authoritative web link.
- Also records git-derived repo, branch, commit SHA, remote, and file path when available.
- Validates routing list existence.
- Runs every alert query once against cloud using the declared `window`.
- Accepts the upload even if the validation query returns rows, because returned rows mean the alert is currently firing, not invalid.
- Rejects upload if any query fails to execute or returns a result too large for validation bounds.
- Upserts alert definitions by `(organization_id, service, name)`.
- Treats the uploaded file as authoritative for `(organization_id, service, source_url)`: included alerts are upserted, and active alerts previously uploaded from the same `source_url` for the same service are deactivated when omitted.

CLI JSON output for data-returning commands must include applied options and filters, following `docs/cli-guidelines.md`.

## Web And Routing

The web app gets an Alerts area with:

- Alert rules: service, name, severity, routing list, evaluation interval, window, last evaluation status, source link, and active/deactivated state.
- Active alerts and history: current firing/resolved state, summary, description, row count, bounded evidence rows, first fired time, last seen time, last evaluated time, and resolved time.
- Routing lists: built-ins plus custom lists.

Routing list behavior:

- Built-ins are virtual and resolve dynamically from current org membership.
- `everyone` includes all current org members.
- `admins` includes current org members with `admin` or `owner` role.
- `owners` includes current org members with `owner` role.
- Custom lists store explicit user memberships in Postgres.
- Alert definitions reference exactly one routing slug.
- Upload validation rejects unknown routing slugs.
- Delivery resolves recipients at event time, so membership changes apply immediately.

## Evaluation And State

Each active alert definition has app-owned scheduling fields. `pg-boss` runs scanner jobs that claim due definitions and enqueue evaluation jobs. `pg-boss` does not own the alert schedule of record.

The scanner flow:

1. Select a bounded batch of active definitions where `next_evaluation_at <= now()`.
2. Lock and claim those rows in Postgres.
3. Compute each definition's next due time from its `evaluationInterval` and stable jitter.
4. Enqueue an `alert-evaluate` job for each claimed definition.

The evaluation job:

1. Load the active alert definition and org context.
2. No-op if the definition is no longer active.
3. Substitute `{{ window }}` with a validated ClickHouse interval fragment.
4. Execute the query through the tenant-scoped ClickHouse path used by cloud SQL.
5. Normalize and bound returned rows into JSON evidence.
6. If rows are non-empty and previous state is inactive or resolved, create a firing event.
7. If rows are non-empty and previous state is firing, update `last_seen_at`, row count, and evidence snapshot.
8. If rows are empty and previous state is firing, create a resolved event.
9. Emit an alert notification event through Postgres/SSE for affected recipients.

SQL/runtime errors:

- Do not change firing/resolved state.
- Update `last_evaluation_error` on the rule.
- Create an `evaluation_failed` event visible in the rule page.
- Use `pg-boss` retry behavior for transient failures where appropriate.

Retention:

- Everr-owned alert events and evidence are retained for 7 days.
- Current alert state is retained while the definition remains active.
- `pg-boss` queue retention uses `deleteAfterSeconds` and `retentionSeconds` aligned to the 7-day policy where those options apply.

## Notification Delivery

Alert events get a distinct payload type, separate from CI workflow notifications. The existing SSE infrastructure should be extended to carry discriminated payloads, for example:

- `type: "workflow"` for current CI workflow updates.
- `type: "alert"` for alert events.

Desktop behavior:

- Desktop keeps the existing authenticated tenant SSE subscription.
- Server-side delivery filters alert events by authenticated recipient user ID before sending.
- `critical` alert firing events enqueue a desktop popup.
- `warning` alert firing events update alert lists/history without opening a popup.
- Resolved events update alert lists/history without opening a popup.
- CI failure notifications keep their existing payload and UI path.

## Postgres Data Model

Proposed tables:

- `alert_definitions`
  - Org ID, service, name, severity, routing slug, evaluation interval, window, next evaluation time, schedule jitter, last enqueued time, raw YAML fragment, parsed query, summary template, description template, source URL, git metadata, active flag, validation status, last evaluation status.
- `alert_routing_lists`
  - Custom org routing lists. Built-ins are virtual and not stored here.
- `alert_routing_list_members`
  - Explicit users for custom lists.
- `alert_states`
  - One current state per alert definition.
- `alert_events`
  - Firing, resolved, and evaluation-failed events with bounded evidence rows and evaluation scheduled time.

Do not generate Drizzle migrations until implementation reaches the migration step requested by the user. Schema work first updates Drizzle definitions only.

## Module Boundaries

Add alerting code under focused modules:

- `packages/app/src/server/alerts/`
  - `pg-boss` runtime startup, due-alert scanner, evaluation worker, query substitution, state transitions, routing resolution, and cleanup.
- `packages/app/src/data/alerts/`
  - Web server functions and data loaders.
- `packages/app/src/routes/api/cli/alerts/*`
  - CLI test and upload endpoints.
- `packages/app/src/db/notify.ts` and `packages/app/src/db/notification-hub.ts`
  - Alert payload support alongside workflow payload support.
- `packages/desktop-app/src-cli`
  - `alerts test` and `alerts upload` commands.
- `packages/desktop-app/src`
  - Alert list/history surfaces and critical popup rendering.

## Bounds And Auditability

Query evidence is bounded at every boundary:

- Store at most 50 evidence rows per alert evaluation.
- Store at most 64 KiB of evidence JSON per alert event/state snapshot.
- CLI output must stay under the existing CLI guideline target of about 30 KiB for normal use by summarizing row counts and truncation status before printing evidence.
- Web and desktop detail views show whether evidence was truncated.

Alert upload auditability:

- Store `created_by_user_id`, `updated_by_user_id`, `created_at`, and `updated_at` on alert definitions.
- Store the authoritative `source_url`.
- Store git-derived repo, branch, commit SHA, remote, and file path when available.
- Show uploader, last updater, and source link in the web rule page.
- Org admins and owners can deactivate any alert rule from the web app, even though any member can upload.

## Testing

Unit tests:

- YAML schema validation.
- Window parsing and ClickHouse interval substitution.
- Template rendering.
- Routing list resolution.
- Alert state transitions.
- Evidence row bounding.

API route tests:

- Upload/test authentication.
- Member upload permission.
- Routing validation.
- Query validation success and failure.
- Upsert semantics by `(organization_id, service, name)`.

pg-boss/evaluator tests:

- Firing transition.
- Repeated firing update.
- Resolution transition.
- Evaluation failure does not change active state.
- Scanner claims due alerts and advances `next_evaluation_at`.
- Two worker processes sharing one Postgres database do not double-enqueue or double-apply the same alert evaluation.
- Queue retry behavior records evaluation failure without changing firing state.
- Load-oriented test covers a large due set by batching scanner claims.

CLI tests:

- Parser/help output.
- Cloud default and `--local` targeting.
- Mocked upload/test API calls.
- JSON output includes applied options.

Desktop tests:

- `critical` opens a popup.
- `warning` does not open a popup.
- Alert payloads do not break existing CI failure notifications.

## Validated Risk Status

- Redis/BullMQ: rejected. Redis is not acceptable for this system.
- DBOS inside the TanStack/Vite server build: rejected. DBOS docs say DBOS and workflows cannot be bundled by Vite/Rollup/esbuild and must be external. This no longer matters for the chosen runtime because `pg-boss` is already used in the app.
- Workflow SDK: not chosen for v1. The Postgres World is viable, but it adds workflow transforms, workflow storage, framework endpoints, and workflow history around a workload that is fundamentally scheduled query evaluation. The Postgres World also uses Graphile Worker underneath, so direct queueing is the simpler scaling path.
- Graphile Worker: not chosen for v1. It has excellent Postgres queue performance, but Everr already uses `pg-boss`, and v1 does not need Graphile's database-centric task model.
- Per-alert runtime cron schedules: rejected for scale. At 5,000 alerts per minute, app-owned due-time scanning is a better shape than thousands of dynamic cron entries.
- Multiple worker replicas: accepted with required verification. `pg-boss` distributes claimed jobs through Postgres locks, and the scanner additionally uses app-table row locks. Implementation must run a two-process integration test against one Postgres database.
- 5,000 alerts per minute: partially validated. Queue throughput should not be the primary bottleneck; ClickHouse query concurrency and cost are. Implementation must load test scanner batching and evaluation concurrency before treating this capacity target as satisfied.
- Queue retention: resolved by design. Use `pg-boss` `deleteAfterSeconds` and `retentionSeconds` where applicable, while Everr-owned alert events and evidence remain the authoritative 7-day history.
- Query result bounds: resolved by design. Evidence row and byte limits are mandatory.
- Member upload risk: accepted product risk with mitigations. Any member can upload, but source links, uploader metadata, and admin/owner deactivation make changes auditable and reversible.

## Approved Decisions

- Free-form Grafana-style alert rules, not SLO/SLI.
- One SQL query per alert.
- The query returns violating rows.
- One alert instance per rule.
- Non-empty query result fires; empty result resolves.
- Keep `{{ window }}` templating.
- Require `summary`; allow optional `description`.
- Keep root `service`.
- Validate upload by running each query against cloud.
- Use fixed severities: `critical` and `warning`.
- Each alert references exactly one routing list slug.
- Built-in routing lists: `everyone`, `admins`, `owners`.
- Any org member can upload alert YAML.
- Use `pg-boss` for alert orchestration.
- Use app-owned due-time scanning instead of one runtime schedule per alert.
- Support multiple app/worker replicas with Postgres-backed queueing and app-level idempotency.
