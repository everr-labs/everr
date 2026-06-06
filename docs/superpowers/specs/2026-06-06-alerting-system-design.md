# Alerting System Design

Date: 2026-06-06

## Summary

Everr will add a YAML-defined alerting system for free-form observability alerts. The v1 model avoids SLO/SLI terminology and uses a Grafana-style rule shape: users write a ClickHouse SQL query that returns violating rows. If the query returns at least one row, the alert is firing. If it returns zero rows, the alert resolves.

Alert definitions are managed only through YAML files. Users can test definitions locally through the Everr CLI against cloud data by default, or local telemetry with `--local`. Users can upload alert definitions through the CLI. Uploads store an explicit source URL and git-derived metadata when available, so the web app can link back to the definition.

DBOS TypeScript runs in a separate long-lived alert worker process and uses the existing Postgres database as its persistence layer. The TanStack/Vite web server does not import DBOS or alert workflow modules.

## Goals

- Support YAML-only alert definitions.
- Make alert rules simple to understand: a query returns bad rows, so the alert fires.
- Run orchestration with the DBOS TypeScript SDK in a dedicated alert worker process.
- Use the existing Postgres database for DBOS persistence and app alert state.
- Retain Everr-owned alert state, events, and evidence for 7 days.
- Retain DBOS workflow history for 7 days when the DBOS TypeScript SDK exposes a library-only retention control.
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

## Current Project Context

The web app is `@everr/app`, built with TanStack Start, Vite, Drizzle, Postgres, and ClickHouse helpers. It already has:

- Drizzle schema and startup migrations in `packages/app/src/server.ts`.
- Existing Postgres connection helpers in `packages/app/src/db/client.ts`.
- Existing Postgres `LISTEN/NOTIFY` and SSE fanout for workflow updates.
- Existing CLI routes under `packages/app/src/routes/api/cli/*`.
- A Rust CLI in `packages/desktop-app/src-cli`.
- A Tauri desktop app that already consumes authenticated tenant SSE events and displays CI failure notifications.

The current GitHub event worker uses `pg-boss`, but this alerting system should use DBOS for orchestration.

## DBOS Integration

DBOS is initialized from a dedicated alert worker startup path after all alert workflows are registered. The worker configures DBOS with:

- Stable app name, for example `everr-alerting`.
- Existing Postgres connection URL or pool.
- Dedicated DBOS schema, for example `dbos_alerting`.
- Application version from deploy metadata when available.
- Queue limits for alert evaluation concurrency.

Alert evaluation is registered as a DBOS workflow. Active alert definitions create or update dynamic DBOS schedules keyed by alert definition ID. DBOS schedules use each alert's `evaluationInterval`.

DBOS TypeScript schedule support is validated by the current docs. Schedules are stored in the database, can be created at runtime, can be atomically applied with `DBOS.applySchedules`, and can be paused, resumed, deleted, listed, backfilled, or triggered. DBOS also supports many dynamic schedules for the same workflow by passing context with each schedule.

The TanStack/Vite/Nitro web server is not the DBOS host. DBOS documentation says DBOS and workflows cannot be bundled by Vite, Rollup, esbuild, Webpack, Parcel, or similar bundlers. The current `@everr/app` production server is a Nitro `.output/server` bundle with TanStack server modules emitted into generated `_ssr` chunks, so importing DBOS workflow modules from the web server graph is a no-go for v1.

The alert worker must be built and deployed outside the TanStack Start server bundle. It can live in this repo and share app-owned database, ClickHouse, alert parser, and notification code, but the web server must not import the DBOS SDK or workflow registration modules. Production runs the web server and alert worker as separate process roles.

Important deployment assumption: the alert worker runs as a long-lived Node process, not as serverless request isolates. DBOS explicitly does not support serverless frameworks because it runs long-lived background jobs. If production uses multiple alert worker replicas, DBOS schedule and recovery behavior must be verified in that topology so alert evaluation does not duplicate work. DBOS constructs a scheduled-workflow idempotency key from schedule name and scheduled time, which should protect duplicate executions, but the implementation must still prove this with two worker processes sharing one Postgres database.

### DBOS Validation Findings

The requested retention is 7 days. DBOS documentation confirms library configuration with `systemDatabaseUrl`, dynamic schedules, and queues. The retention controls found in the current docs are documented through DBOS Console/Conductor, not clearly as a library-only TypeScript config option. Implementation must verify whether the SDK exposes a self-hosted retention API or config before claiming DBOS workflow-history retention is satisfied.

The DBOS client can delete known workflows and their associated data, but that is workflow management, not a documented time-based retention policy. If the SDK supports library-only workflow history retention, configure it to 7 days. If it does not, v1 still retains Everr-owned alert events and evidence for 7 days, but DBOS workflow-history retention remains unresolved. Do not perform unsupported direct cleanup of DBOS system tables unless DBOS documents that path.

References checked:

- https://docs.dbos.dev/typescript/reference/configuration
- https://docs.dbos.dev/typescript/tutorials/scheduled-workflows
- https://docs.dbos.dev/typescript/reference/queues
- https://docs.dbos.dev/typescript/reference/client
- https://docs.dbos.dev/typescript/integrating-dbos
- https://docs.dbos.dev/typescript/prompting
- https://docs.dbos.dev/production/dbos-cloud/retention
- https://vite.dev/config/ssr-options.html
- https://vite.dev/guide/ssr.html
- https://nitro-docs.pages.dev/config/

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

Each active alert definition has a DBOS-managed schedule based on `evaluationInterval`.

The evaluation workflow:

1. Load the active alert definition and org context.
2. Substitute `{{ window }}` with a validated ClickHouse interval fragment.
3. Execute the query through the tenant-scoped ClickHouse path used by cloud SQL.
4. Normalize and bound returned rows into JSON evidence.
5. If rows are non-empty and previous state is inactive or resolved, create a firing event.
6. If rows are non-empty and previous state is firing, update `last_seen_at`, row count, and evidence snapshot.
7. If rows are empty and previous state is firing, create a resolved event.
8. Emit an alert notification event through Postgres/SSE for affected recipients.

SQL/runtime errors:

- Do not change firing/resolved state.
- Update `last_evaluation_error` on the rule.
- Create an `evaluation_failed` event visible in the rule page.
- Use DBOS retry behavior for transient failures where appropriate.

Retention:

- Everr-owned alert events and evidence are retained for 7 days.
- Current alert state is retained while the definition remains active.
- DBOS workflow history retention is configured for 7 days only if the SDK supports it in library-only mode. Otherwise, this remains an explicit implementation blocker for the DBOS-history part of the retention requirement.

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
  - Org ID, service, name, severity, routing slug, evaluation interval, window, raw YAML fragment, parsed query, summary template, description template, source URL, git metadata, active flag, validation status, last evaluation status.
- `alert_routing_lists`
  - Custom org routing lists. Built-ins are virtual and not stored here.
- `alert_routing_list_members`
  - Explicit users for custom lists.
- `alert_states`
  - One current state per alert definition.
- `alert_events`
  - Firing, resolved, and evaluation-failed events with bounded evidence rows.

Do not generate Drizzle migrations until implementation reaches the migration step requested by the user. Schema work first updates Drizzle definitions only.

## Module Boundaries

Add alerting code under focused modules:

- `packages/app/src/server/alerts/`
  - DBOS registration, schedule reconciliation, evaluation workflow, query substitution, state transitions, routing resolution, and cleanup.
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

DBOS/evaluator tests:

- Firing transition.
- Repeated firing update.
- Resolution transition.
- Evaluation failure does not change active state.
- Worker build/start smoke test proves DBOS and workflow modules are outside the TanStack/Vite/Nitro web bundle.
- Two worker processes sharing one Postgres database do not double-apply the same scheduled alert evaluation.

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

- DBOS library-only retention: unresolved. Current DBOS configuration docs do not expose a retention field, and the documented retention policy UI is DBOS Console/Conductor. `deleteWorkflow` and `deleteWorkflows` exist, but they are manual workflow-management APIs rather than a supported time-based policy. This remains the only hard unresolved risk.
- DBOS dynamic per-alert schedules: resolved. TypeScript docs support runtime `createSchedule`, `applySchedules`, pause/resume/delete, listing, backfill, triggering, database-stored schedules, and dynamic many-schedule patterns.
- DBOS inside the TanStack/Vite server build: no-go for v1. DBOS docs say DBOS and workflows cannot be bundled by Vite/Rollup/esbuild and must be external. The current `@everr/app` production output is a Nitro `.output/server` bundle with TanStack server modules emitted into generated `_ssr` chunks. The design therefore moves DBOS to a separate alert worker process and keeps DBOS workflow modules out of the web server import graph.
- Multiple worker replicas: partially validated. DBOS scheduled workflows use schedule-name plus scheduled-time idempotency keys, so duplicate execution should be prevented through Postgres. Because the TypeScript docs do not explicitly show the multi-replica case, implementation must run a two-process worker integration test against one Postgres database.
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
- Use DBOS in a separate alert worker process because the TanStack/Vite/Nitro web bundle is incompatible with DBOS workflow bundling constraints.
