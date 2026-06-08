# Alerting System Design

Date: 2026-06-06

## Summary

Everr will add a YAML-defined alerting system for free-form observability alerts. The v1 model avoids SLO/SLI terminology and uses a Grafana-style rule shape: users write a ClickHouse SQL query that returns violating rows. If the query returns at least one row, the alert is firing. If it returns zero rows, the alert resolves.

Alert definitions are managed through repo-level `.everr` YAML config files. Users can test definitions locally through the Everr CLI against cloud data by default, or local telemetry with `--local`. Users can apply alert definitions through the CLI. Apply scans the current git repository for `.everr` configs, computes the desired alert set for that repo, and applies the diff to Everr.

Alert orchestration uses Graphile Worker with the existing Postgres database. Everr-owned alert tables remain the source of truth for schedules, state, events, and retention. Graphile Worker is used for distributed queueing, retries, and a small number of scanner jobs; Everr does not create one cron task per alert.

## Goals

- Support YAML-only alert definitions.
- Make alert rules simple to understand: a query returns bad rows, so the alert fires.
- Run orchestration with Graphile Worker.
- Use the existing Postgres database for queue persistence and app alert state.
- Retain Everr-owned alert state, events, and evidence for 7 days.
- Keep Graphile Worker job cleanup bounded; Everr-owned alert history remains the authoritative 7-day record.
- Test repo `.everr` alert config from the CLI against cloud or local telemetry.
- Apply repo `.everr` alert config from the CLI and validate SQL before activation.
- Store source metadata so web users can open the definition in the repository.
- Deliver v1 alert notifications through one organization-level alert settings config.
- Support email delivery through Resend and Telegram delivery in the MVP.

## Non-Goals

- No SLO, SLI, objective, error-budget, or burn-rate model in v1.
- No PromQL or SLOTH compatibility beyond loose inspiration from YAML-based declarations.
- No per-row alert instances in v1. A rule has one alert state even if it returns many rows.
- No path-argument apply command in v1.
- No standalone delete command in the first CLI scope. `everr alerts apply` removes rules omitted from the discovered repo configs.
- No Slack, PagerDuty, or generic webhook notification targets in v1.
- No durable workflow engine in v1. Alert evaluation is a scheduled queue job plus app-owned state transitions.

## Current Project Context

The web app is `@everr/app`, built with TanStack Start, Vite, Drizzle, Postgres, and ClickHouse helpers. It already has:

- Drizzle schema and startup migrations in `packages/app/src/server.ts`.
- Existing Postgres connection helpers in `packages/app/src/db/client.ts`.
- Existing Postgres `LISTEN/NOTIFY` and SSE fanout for workflow updates.
- Existing CLI routes under `packages/app/src/routes/api/cli/*`.
- A Rust CLI in `packages/desktop-app/src-cli`.
- A Tauri desktop app that already consumes authenticated tenant SSE events and displays CI failure notifications.

The current GitHub event worker uses `pg-boss`, but alerting should use Graphile Worker for orchestration and scheduling. Alerting should not add DBOS, Workflow SDK, Duroxide, Redis, or another workflow runtime.

## Graphile Worker Orchestration

Graphile Worker is initialized from alert runtime startup code using the existing Postgres pool. The runtime configures:

- Existing Postgres connection through the `db.executeSql` adapter pattern already used by the GitHub event runtime.
- A task for due-alert scans, for example `alert-scan`.
- A task for alert evaluations, for example `alert-evaluate`.
- A recurring Graphile Worker cron entry for the scanner task.
- Task-level retry, backoff, queue, and job-key choices.
- Worker concurrency settings sized by deploy environment.

The alert runtime can run inside the long-lived TanStack Start server process, but the alert modules should still be factored so they can be started as a dedicated Graphile Worker role later if production needs separate web and worker scaling.

### Scheduling Model

Everr does not create one recurring Graphile Worker cron entry per alert. At 5,000 alerts per minute, thousands of independent cron entries would be the wrong scaling shape.

Instead, Everr owns scheduling state in `alert_definitions`:

- `evaluation_interval_seconds`
- `next_evaluation_at`
- `schedule_jitter_seconds`
- `last_enqueued_at`

A single recurring Graphile Worker cron entry runs the scanner every minute. The scanner:

1. Claims active due alerts from `alert_definitions` using a bounded query and Postgres row locking.
2. Advances `next_evaluation_at` according to each alert's `evaluationInterval` plus stable jitter.
3. Enqueues one Graphile Worker `alert-evaluate` job per claimed alert with an evaluation timestamp.
4. Stops when it reaches its batch limit, allowing the next scanner tick or another scanner worker to claim more due alerts.

The scanner is safe with multiple app or worker replicas because Postgres row locks prevent the same due alert from being claimed twice in the same batch. The evaluation worker is also safe with multiple replicas because Graphile Worker uses Postgres-backed job locking to distribute work.

### Scale And Backpressure

5,000 evaluations per minute is about 83 evaluations per second. The queue can handle this shape, but ClickHouse query cost is the real capacity limit.

Required ClickHouse concurrency is approximately:

```text
83 * average_query_seconds
```

The implementation must use explicit query concurrency controls:

- Global alert evaluation concurrency.
- Optional per-organization concurrency to avoid one org consuming the fleet.
- Graphile Worker `concurrentJobs` sized with the number of app/worker replicas in mind.
- Bounded scanner batch size so a large due set does not create an unbounded queue spike.
- Stable schedule jitter so thousands of one-minute alerts do not all enqueue in the same second.

Alert evaluation remains at-least-once at the application level. Even if the worker claims a job once, retries, worker crashes, and deployment races require idempotent state transitions keyed by `(alert_definition_id, evaluation_scheduled_for)`.

References checked:

- https://worker.graphile.org/docs
- https://worker.graphile.org/docs/performance
- https://workflow-sdk.dev/docs/deploying/world/postgres-world

## YAML Format

The YAML format is repo-scoped and alert-focused. The file name is `.everr`.

```yaml
version: everr/v1
repoId: github:123456789
labels:
  team: platform

alertsSettings:
  notificationDelivery:
    email:
      enabled: true
      to:
        - alerts@example.com
    telegram:
      enabled: true
      chatIds:
        - "123456789"

alerts:
  - name: high-5xx-routes
    severity: critical
    evaluationInterval: 1m
    window: 5m
    summary: "${row_count} routes have elevated 5xxs"
    description: "Top route: ${top_route} with ${top_error_count} errors"
    query: |
      SELECT
        SpanAttributes['http.route'] AS route,
        countIf(StatusCode >= 500) AS error_count,
        count() AS request_count
      FROM traces
      WHERE Timestamp >= now() - INTERVAL ${window}
      GROUP BY route
      HAVING error_count >= 10
      ORDER BY error_count DESC
      LIMIT 20
```

Rules:

- `version` must be `everr/v1`.
- `repoId` is required and is the stable repository identifier for alert ownership.
- `repoId` must not be the repository display name, because repositories can be renamed.
- Alert identity is `(organization_id, repo_id, name)`.
- Alert names must be unique across all `.everr` configs discovered for the same `repoId`.
- Apply upserts by alert identity.
- `previousName` is optional and supports a one-time rename from `(organization_id, repo_id, previousName)` to `(organization_id, repo_id, name)`.
- Without `previousName`, changing an alert name is treated as remove old alert plus add new alert.
- `severity` is fixed to `critical` or `warning`.
- `critical` and `warning` both create alert events and use the configured delivery targets.
- Severity is included in persisted state, history logs, and delivered messages.
- `alertsSettings.notificationDelivery` is the single organization-level alert delivery config.
- MVP delivery targets are `email` and `telegram`.
- Email delivery uses Resend.
- Telegram delivery sends to configured chat IDs.
- Alert definitions do not reference routing lists.
- `evaluationInterval` is required per alert.
- `evaluationInterval` must be at least `1m` in v1.
- `window` is required per alert.
- `query` must return only violating rows.
- A non-empty query result means firing.
- An empty query result means resolved.
- Returned rows are bounded evidence for the rule, not separate alert instances.
- `summary` is required.
- `description` is optional.
- `summary`, `description`, and `query` can use Everr alert variables with `${name}` syntax.
- Supported variables include `${window}`, `${row_count}`, `${top_route}`, `${top_error_count}`, alert metadata fields, and selected bounded evidence fields.
- `${window}` expands to a validated ClickHouse interval fragment such as `5 MINUTE`, so users write `INTERVAL ${window}`.
- The alert engine must only expand allowlisted variables and generated fragments; it must not support arbitrary expression interpolation.
- Apply validation rejects unknown variables and any variable not explicitly supported by the alert renderer.

## CLI Flow

Add an `alerts` command group:

```bash
everr alerts test
everr alerts test --local
everr alerts apply
```

`alerts test`:

- Defaults to cloud.
- Targets local telemetry with `--local`.
- Discovers every `.everr` config in the current git repository.
- Requires all discovered configs to declare the same `repoId`.
- Parses YAML.
- Validates schema, window formats, template syntax, and alert variable expansion.
- Runs each alert query with its declared `window`.
- Prints whether each alert is currently firing.
- Prints bounded evidence rows.
- Does not persist alert state.
- Does not send notifications.

`alerts apply`:

- Requires authentication.
- Is allowed for any organization member.
- Discovers every `.everr` config in the current git repository.
- Requires all discovered configs to declare the same `repoId`.
- Submits the raw YAML fragments and parsed metadata.
- Records git-derived repo, branch, commit SHA, remote, and config file path when available.
- Validates the alert settings delivery config.
- Runs every alert query once against cloud using the declared `window`.
- Accepts the apply even if the validation query returns rows, because returned rows mean the alert is currently firing, not invalid.
- Rejects apply if any query fails to execute or returns a result too large for validation bounds.
- Builds the desired alert set keyed by `(organization_id, repo_id, name)`.
- Adds new alerts, updates changed alerts, applies explicit renames through `previousName`, and removes active alerts that are no longer present in any discovered `.everr` config for the repo.
- Removed alerts are deactivated and unscheduled; retained history follows the normal retention policy.
- Rejects duplicate alert names across discovered configs for the same `repoId`.

CLI JSON output for data-returning commands must include applied options and filters, following `docs/cli-guidelines.md`.

## Alerts Page

The web app gets one Alerts page with:

- A list of configured alerts.
- Each alert detail displays the alert config.
- Alert details include repo ID, name, severity, evaluation interval, window, source link, active/deactivated state, current firing/resolved state, last evaluation status, and the configured notification delivery settings.
- Alert details show the latest bounded evidence rows and links to persisted alert history.

Alert settings behavior:

- There is one notification delivery config per organization.
- `everr alerts apply` can create or replace the organization alert settings declared by `alertsSettings`.
- The settings can also be edited from the Alerts page.
- MVP settings support Resend-backed email recipients and Telegram chat IDs.
- Delivery uses the latest saved settings at event time.

## Evaluation And State

Each active alert definition has app-owned scheduling fields. Graphile Worker runs scanner jobs that claim due definitions and enqueue evaluation jobs. Graphile Worker does not own the alert schedule of record.

The scanner flow:

1. Select a bounded batch of active definitions where `next_evaluation_at <= now()`.
2. Lock and claim those rows in Postgres.
3. Compute each definition's next due time from its `evaluationInterval` and stable jitter.
4. Enqueue an `alert-evaluate` job for each claimed definition.

The evaluation job:

1. Load the active alert definition and org context.
2. No-op if the definition is no longer active.
3. Expand Everr alert variables such as `${window}` using validated, allowlisted values.
4. Execute the query through the tenant-scoped ClickHouse path used by cloud SQL.
5. Normalize and bound returned rows into JSON evidence.
6. If rows are non-empty and previous state is inactive or resolved, create a firing event.
7. If rows are non-empty and previous state is firing, update `last_seen_at`, row count, and evidence snapshot.
8. If rows are empty and previous state is firing, create a resolved event.
9. Persist alert history as OpenTelemetry logs with `service.name = "alert"` and `service.namespace = "everr"`.
10. Dispatch notifications through the current alert notification delivery settings.

SQL/runtime errors:

- Do not change firing/resolved state.
- Update `last_evaluation_error` on the rule.
- Create an `evaluation_failed` event visible in the rule page.
- Use Graphile Worker retry behavior for transient failures where appropriate.

Retention:

- Everr-owned alert events and evidence are retained for 7 days.
- Alert history is also persisted as OpenTelemetry logs with `service.name = "alert"` and `service.namespace = "everr"`.
- Current alert state is retained while the definition remains active.
- Graphile Worker job cleanup must stay bounded, while Everr-owned alert events and OpenTelemetry logs remain the authoritative 7-day history.

## Notification Delivery

Notification delivery is driven by the single organization alert settings config, not by per-alert routing lists.

MVP delivery targets:

- Email through Resend.
- Telegram messages to configured chat IDs.

Delivery behavior:

- Firing events deliver according to the current saved alert settings.
- Resolved events are recorded in alert history and may be delivered if the saved settings enable resolution delivery.
- Delivery failures do not change alert firing/resolved state.
- Delivery attempts and failures are recorded as alert history logs.
- The Alerts page reads persisted state and OpenTelemetry log history instead of depending on delivery payload retention.
- CI failure notifications keep their existing payload and UI path.

## Postgres Data Model

Proposed tables:

- `alert_definitions`
  - Org ID, repo ID, name, severity, evaluation interval, window, next evaluation time, schedule jitter, last enqueued time, raw YAML fragment, parsed query, summary template, description template, config file path, source link, git metadata, active flag, validation status, last evaluation status.
- `alert_settings`
  - One row per org with the notification delivery config JSON for email and Telegram.
- `alert_states`
  - One current state per alert definition.
- `alert_events`
  - Current app-owned event records for firing, resolved, and evaluation-failed events with bounded evidence rows and evaluation scheduled time.

OpenTelemetry logs:

- Persist alert history as logs with `service.name = "alert"` and `service.namespace = "everr"`.
- Log records include org ID, alert definition ID, repo ID, name, severity, event type, evaluation scheduled time, row count, truncation flags, delivery target type, delivery outcome, config file path, and source link.

Do not generate Drizzle migrations until implementation reaches the migration step requested by the user. Schema work first updates Drizzle definitions only.

## Module Boundaries

Add alerting code under focused modules:

- `packages/app/src/server/alerts/`
  - Graphile Worker runtime startup, due-alert scanner, evaluation worker, alert variable expansion, state transitions, notification delivery, alert history log emission, and cleanup.
- `packages/app/src/data/alerts/`
  - Web server functions and data loaders.
- `packages/app/src/routes/api/cli/alerts/*`
  - CLI test and apply endpoints.
- `packages/app/src/db/notify.ts` and `packages/app/src/db/notification-hub.ts`
  - Keep CI workflow notification behavior intact.
- `packages/desktop-app/src-cli`
  - `alerts test` and `alerts apply` commands.
- `packages/app/src/lib/mailer.server.ts`
  - Reuse Resend mailer infrastructure for email alert delivery.
- `docs/superpowers/specs/` and `/Users/guidodorsi/.agents/skills/everr-setup-telemetry`
  - Update the telemetry setup skill to include an alert rule example for emitted alert history logs with `service.name = "alert"` and `service.namespace = "everr"`.

## Bounds And Auditability

Query evidence is bounded at every boundary:

- Store at most 50 evidence rows per alert evaluation.
- Store at most 64 KiB of evidence JSON per alert event/state snapshot.
- CLI output must stay under the existing CLI guideline target of about 30 KiB for normal use by summarizing row counts and truncation status before printing evidence.
- Alert detail views show whether evidence was truncated.

Alert apply auditability:

- Store `created_by_user_id`, `updated_by_user_id`, `created_at`, and `updated_at` on alert definitions.
- Store the config file path, source link, and git-derived repo, branch, commit SHA, and remote when available.
- Show creator, last applier, and source link in the web rule page.
- Org admins and owners can deactivate any alert rule from the web app, even though any member can apply.

## Testing

Unit tests:

- YAML schema validation.
- Window parsing and alert variable expansion.
- Template rendering.
- Alert settings validation.
- Alert state transitions.
- Evidence row bounding.
- OpenTelemetry alert history log payload construction.

API route tests:

- Apply/test authentication.
- Member apply permission.
- Alert settings validation.
- Query validation success and failure.
- Upsert semantics by `(organization_id, repo_id, name)`.
- Apply diff semantics for add, update, explicit rename, and remove.

Graphile Worker/evaluator tests:

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
- `.everr` discovery in a git repo.
- Mocked apply/test API calls.
- JSON output includes applied options.

Desktop tests:

- Alerting changes do not break existing CI failure notifications.

Notification delivery tests:

- Critical and warning firing events use the saved alert delivery config.
- Resend email delivery is invoked for configured email recipients.
- Telegram delivery is invoked for configured chat IDs.
- Delivery failures are logged without changing firing/resolved state.

## Validated Risk Status

- Redis/BullMQ: rejected. Redis is not acceptable for this system.
- DBOS inside the TanStack/Vite server build: rejected. DBOS docs say DBOS and workflows cannot be bundled by Vite/Rollup/esbuild and must be external.
- Workflow SDK: not chosen for v1. The Postgres World is viable, but it adds workflow transforms, workflow storage, framework endpoints, and workflow history around a workload that is fundamentally scheduled query evaluation. The Postgres World also uses Graphile Worker underneath, so direct queueing is the simpler scaling path.
- Graphile Worker: chosen for v1 orchestration and scheduling. It keeps the runtime Postgres-backed and avoids a separate queue service.
- `pg-boss`: not chosen for alerting, even though it exists in the app today.
- Per-alert runtime cron schedules: rejected for scale. At 5,000 alerts per minute, app-owned due-time scanning is a better shape than thousands of dynamic cron entries.
- Multiple worker replicas: accepted with required verification. Graphile Worker distributes claimed jobs through Postgres-backed locking, and the scanner additionally uses app-table row locks. Implementation must run a two-process integration test against one Postgres database.
- 5,000 alerts per minute: partially validated. Queue throughput should not be the primary bottleneck; ClickHouse query concurrency and cost are. Implementation must load test scanner batching and evaluation concurrency before treating this capacity target as satisfied.
- Queue retention: resolved by design. Keep Graphile Worker job cleanup bounded, while Everr-owned alert events and evidence remain the authoritative 7-day history.
- Query result bounds: resolved by design. Evidence row and byte limits are mandatory.
- Member apply risk: accepted product risk with mitigations. Any member can apply, but source links, applier metadata, and admin/owner deactivation make changes auditable and reversible.
- Alert history persistence: resolved by design. App state remains in Postgres for current behavior, while alert history is also emitted as OpenTelemetry logs with `service.name = "alert"` and `service.namespace = "everr"`.

## Approved Decisions

- Free-form Grafana-style alert rules, not SLO/SLI.
- One SQL query per alert.
- The query returns violating rows.
- One alert instance per rule.
- Non-empty query result fires; empty result resolves.
- Use Everr `${name}` alert variable notation, including `${window}` derived from `window`.
- Require `summary`; allow optional `description`.
- Remove root `service`; alert ownership is repo-scoped.
- Use `.everr` repo-level config files.
- Identify alerts by `(organization_id, repo_id, name)`.
- Validate apply by running each query against cloud.
- Use fixed severities: `critical` and `warning`.
- Use one organization alert settings config for notification delivery.
- Support email through Resend and Telegram in the MVP delivery config.
- Persist alert history as OpenTelemetry logs with `service.name = "alert"` and `service.namespace = "everr"`.
- Any org member can apply alert YAML.
- `everr alerts apply` scans repo configs and applies the diff for add, update, explicit rename, and remove.
- Use Graphile Worker for alert orchestration and scheduling.
- Use app-owned due-time scanning instead of one runtime schedule per alert.
- Support multiple app/worker replicas with Postgres-backed queueing and app-level idempotency.
