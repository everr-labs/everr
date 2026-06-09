# Alerting System Design

Date: 2026-06-06

## Summary

Everr will add a YAML-defined alerting system for free-form observability alerts. The v1 model avoids SLO/SLI terminology and uses a Grafana-style rule shape: users write a ClickHouse SQL query that returns violating rows. If the query returns at least one row, the alert is firing. If it returns zero rows, the alert resolves.

Alert definitions are managed as YAML resource files in an apply directory. The apply root has an `everr.yml` file that contains only a `repoid` string used as the stable repository identifier. Users can test definitions locally through the Everr CLI against cloud data by default, or local telemetry with `--local`. Users can apply dashboards and alerts through the shared apply flow. Apply reads dashboard and alert resources from the requested directory, sends one normalized `state` payload to the apply API, derives alert identity from `repoid` and `metadata.name`, and applies the diff to Everr.

Alert orchestration uses Graphile Worker with the existing Postgres database. Everr-owned Postgres tables remain the source of truth for definitions, scheduling, and current state. Alert event history is stored in ClickHouse. Graphile Worker is used for distributed queueing, retries, and a small number of scanner jobs; Everr does not create one cron task per alert.

## Goals

- Support YAML-only alert definitions.
- Make alert rules simple to understand: a query returns bad rows, so the alert fires.
- Run orchestration with Graphile Worker.
- Use the existing Postgres database for queue persistence and app alert state.
- Retain Everr-owned alert state while definitions are active, and retain alert event history using the same per-tenant retention window as logs.
- Keep Graphile Worker job cleanup bounded; ClickHouse `alert_events` remains the authoritative history for the tenant's logs retention window.
- Test alert resource files from the CLI against cloud or local telemetry.
- Apply alert resource files from the CLI and validate SQL before activation.
- Store source metadata so web users can open the definition in the repository.
- Deliver v1 alert notifications through one organization-level alert settings config.
- Configure alert notification settings only through the web UI.
- Support email delivery through Resend and Telegram delivery in the MVP.
- Allow org admins and owners to silence an alert for a bounded time period.

## Non-Goals

- No SLO, SLI, objective, error-budget, or burn-rate model in v1.
- No PromQL or SLOTH compatibility beyond loose inspiration from YAML-based declarations.
- No per-row alert instances in v1. A rule has one alert state even if it returns many rows.
- No standalone delete command in the first CLI scope. `everr apply <dir>` removes rules omitted from the applied state for the target `repoid`.
- No Slack, PagerDuty, or generic webhook notification targets in v1.
- No YAML-managed silences in v1. Silences are operational web/API state, not repo state.
- No durable workflow engine in v1. Alert evaluation is a scheduled queue job plus app-owned state transitions.

## Current Project Context

The web app is `@everr/app`, built with TanStack Start, Vite, Drizzle, Postgres, and ClickHouse helpers. It already has:

- Drizzle schema and startup migrations in `packages/app/src/server.ts`.
- Existing Postgres connection helpers in `packages/app/src/db/client.ts`.
- Existing Postgres `LISTEN/NOTIFY` and SSE fanout for workflow updates.
- Existing CLI routes under `packages/app/src/routes/api/cli/*`.
- A Rust CLI in `packages/desktop-app/src-cli`.
- A Tauri desktop app that already consumes authenticated tenant SSE events and displays CI failure notifications.

The current GitHub event worker already uses Graphile Worker through `graphile-worker` and `run({ pgPool: pool, ... })`. Alerting should reuse that runner setup and event-logging pattern rather than introduce another workflow runtime. Alerting should not add DBOS, Workflow SDK, Duroxide, Redis, `pg-boss`, or another queue/workflow dependency.

## Graphile Worker Orchestration

Graphile Worker is initialized from the long-lived app server process using the existing Postgres pool. The v1 implementation registers alert tasks in the same Graphile Worker `run()` instance as the GitHub event tasks, with a combined task list and shared `graphile_worker` schema. The runtime configures:

- Existing Postgres pool from `@/db/client` through Graphile Worker's `pgPool` option.
- Existing Graphile Worker event logging hooks, extended for alert task identifiers.
- A task for due-alert scans, for example `alert-scan`.
- A task for alert evaluations, for example `alert-evaluate`.
- A recurring Graphile Worker cron entry for the scanner task.
- Task-level retry, backoff, queue, and job-key choices.
- Worker concurrency settings sized by deploy environment.

Alert modules should still be factored so they can move to a dedicated Graphile Worker role later if production needs separate web and worker scaling. That future split can use a second `run()` instance against the same `graphile_worker` schema, but v1 uses the same runner because it is simpler and reuses the existing startup and logging path.

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
- Graphile Worker `concurrency` sized with the number of app/worker replicas in mind.
- Bounded scanner batch size so a large due set does not create an unbounded queue spike.
- Stable schedule jitter so thousands of one-minute alerts do not all enqueue in the same second.

Alert evaluation remains at-least-once at the application level. Even if the worker claims a job once, retries, worker crashes, and deployment races require idempotent state transitions keyed by `(alert_definition_id, evaluation_scheduled_at)`.

References checked:

- https://worker.graphile.org/docs
- https://worker.graphile.org/docs/performance
- https://workflow-sdk.dev/docs/deploying/world/postgres-world

## YAML Format

The apply root contains `everr.yml`. It is a repo identity file, not a resource document, and it contains only `repoid`.

```yaml
repoid: "2f8e3f90-9d1c-5d5f-a0f9-2d8e7f4a25d1"
```

`repoid` is any non-empty string that is unique and stable for the repository. We recommend UUIDv5 generated from a canonical repository identifier, such as the canonical Git remote URL, but the schema does not require UUID syntax.

Alert rules are YAML resource documents. Apply reads `.yaml` and `.yml` resource files from the requested directory recursively, excluding `everr.yml`. Directory layout provides source/folder metadata, but alert identity lives in `everr.yml` plus the document.

```yaml
kind: AlertRule
metadata:
  name: high-5xx-routes
  labels:
    team: platform
spec:
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

- `everr.yml` must contain only `repoid`.
- `repoid` is required, non-empty, and is the stable repository identifier for apply ownership.
- `repoid` should be globally unique. UUIDv5 is recommended, but any string is accepted.
- `kind` must be `AlertRule` for alert definitions.
- `metadata.name` is required and is the alert slug.
- Alert identity is `(organization_id, repoid, slug)`, where `repoid` comes from `everr.yml` and `slug` comes from `metadata.name`.
- Alert names must be unique within the `repoid` across all alert resources in the applied state.
- Apply upserts by alert identity.
- Changing an alert name is treated as remove old alert plus add new alert.
- Alert rules do not include severity in v1.
- Firing and resolved events use the configured delivery targets.
- Alert notification settings are not YAML resources and are not managed by `everr apply`.
- Apply rejects `AlertSettings` resources and any other unknown resource kinds.
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
- Variable names must match `[A-Za-z_][A-Za-z0-9_]*`.
- Variable expressions are exactly `${name}`. Nested expressions, defaults, filters, property access, and arbitrary JavaScript-like expressions are not supported.
- Built-in variables are:
  - `${window}`: validated ClickHouse interval fragment derived from `spec.window`, such as `5 MINUTE`.
  - `${row_count}`: number of rows returned by the bounded evidence query.
- Evidence-derived variables use the `top_` prefix: `${top_<column>}`.
- `${top_<column>}` resolves to the value of `<column>` from the first bounded evidence row after query ordering and limiting.
- For example, if the first evidence row has columns `route` and `error_count`, `${top_route}` resolves to that row's `route` value and `${top_error_count}` resolves to that row's `error_count` value.
- Evidence-derived variables are valid only in `summary` and `description`, not in `query`, because query variables must be known before the query runs.
- Query templates support only `${window}` in v1.
- `summary` and `description` templates support `${row_count}` and `${top_<column>}` variables.
- Apply-time validation runs each query once, reads the returned column names, and rejects any `${top_<column>}` variable whose `<column>` is not present in the validation result schema.
- If validation returns zero rows, evidence-derived variable validation still uses the result column names returned by ClickHouse.
- At runtime, if an allowed `${top_<column>}` variable has no first evidence row because the alert is resolved, the renderer uses an empty string.
- The alert engine must only expand allowlisted variables and generated fragments; it must not support arbitrary expression interpolation.
- Apply validation rejects unknown variables and any variable not explicitly supported by the alert renderer.

## YAML Validation Schemas

Alert YAML MUST use the same validation process as dashboard YAML: parse YAML into unknown data, run the strict Zod schema with `safeParse`, report path-aware validation errors, and only then normalize resources into the apply state. The alert path must not hand-roll schema checks separately from the dashboard validation pipeline.

The Zod definitions for the alerting pieces are:

```ts
import { z } from "zod";

const NonEmptyStringSchema = z.string().min(1);
const LabelsSchema = z.record(NonEmptyStringSchema, NonEmptyStringSchema);

export const EverrConfigYamlSchema = z
  .object({
    repoid: NonEmptyStringSchema,
  })
  .strict();

export const AlertRuleYamlSchema = z
  .object({
    kind: z.literal("AlertRule"),
    metadata: z
      .object({
        name: NonEmptyStringSchema,
        labels: LabelsSchema.optional(),
      })
      .strict(),
    spec: z
      .object({
        evaluationInterval: NonEmptyStringSchema,
        window: NonEmptyStringSchema,
        summary: NonEmptyStringSchema,
        description: z.string().optional(),
        query: NonEmptyStringSchema,
      })
      .strict(),
  })
  .strict();

export const AlertYamlResourceSchema = AlertRuleYamlSchema;

export const ApplyStateSchema = z
  .object({
    dashboards: z.array(DashboardYamlSchema),
    alerts: z.array(AlertRuleYamlSchema),
  })
  .strict();

export const ApplyRequestSchema = z
  .object({
    repoid: NonEmptyStringSchema,
    state: ApplyStateSchema,
    source: ApplySourceSchema.optional(),
  })
  .strict();
```

`DashboardYamlSchema` and `ApplySourceSchema` come from the existing shared apply implementation. The alert implementation must import those schemas instead of duplicating them.

## CLI Flow

Extend apply for alert resources and add an `alerts` test command:

```bash
everr alerts test <dir>
everr alerts test <dir> --local
everr apply <dir>
```

`alerts test`:

- Defaults to cloud.
- Targets local telemetry with `--local`.
- Reads alert YAML resources from the requested directory recursively.
- Parses YAML.
- Validates schema through the same Zod pipeline used by dashboards, then validates window formats, template syntax, and alert variable expansion.
- Runs each alert query with its declared `window`.
- Prints whether each alert is currently firing.
- Prints bounded evidence rows.
- Does not persist alert state.
- Does not send notifications.

`everr apply <dir>` for alert resources:

- Authenticates with exactly one credential kind:
  - `SESSION_TOKEN` from the saved `everr cloud login` session.
  - `INGEST_TOKEN` from `EVERR_API_TOKEN`, intended for CI and non-interactive use.
- If both are available, `EVERR_API_TOKEN` takes precedence.
- The server distinguishes credential type by token shape and resolves the destination organization from that credential. Alert files do not declare an organization and there is no `--org` flag.
- The plan response echoes the destination organization before writes. Interactive terminals require confirmation when there are changes; non-interactive runs require `--yes`.
- Is allowed for any organization member.
- Reads `everr.yml` from the apply root and validates it with `EverrConfigYamlSchema`.
- Reads dashboard and alert YAML resources from the requested directory recursively, excluding `everr.yml`.
- Validates alert YAML through the same Zod pipeline used by dashboards.
- Builds and submits one apply API payload containing the complete desired resource state:

```json
{
  "repoid": "2f8e3f90-9d1c-5d5f-a0f9-2d8e7f4a25d1",
  "state": {
    "dashboards": [],
    "alerts": []
  },
  "source": {
    "branch": "main",
    "commitSha": "abc123",
    "remote": "git@github.com:example/repo.git"
  }
}
```

- The apply API diffs the submitted `state` against the persisted dashboards and alerts for `(organization_id, repoid)`.
- Records git-derived repo, branch, commit SHA, remote, and config file path when available.
- Runs every alert query once against cloud using the declared `window`.
- Accepts the apply even if the validation query returns rows, because returned rows mean the alert is currently firing, not invalid.
- Rejects apply if any query fails to execute or returns a result too large for validation bounds.
- Builds the desired alert set keyed by `(organization_id, repoid, slug)`.
- Adds new alerts, updates changed alerts, and removes active alerts for the `repoid` that are no longer present in `state.alerts`.
- Removed alerts are deactivated and unscheduled; retained history follows the normal retention policy.
- Rejects duplicate alert names within the same `repoid`.

CLI JSON output for data-returning commands must include applied options and filters, following `docs/cli-guidelines.md`.

## Alerts Page

The web app gets one Alerts page with:

- A list of configured alerts.
- Each alert detail displays the alert config.
- Alert details include repoid, slug, evaluation interval, window, source link, active/deactivated state, current firing/resolved state, last evaluation status, and the configured notification delivery settings.
- Alert details show the latest bounded evidence rows and links to persisted alert history.
- Alert details show whether the alert is currently silenced and, if so, the silence end time.
- Org admins and owners can create a silence with a start time, end time, and optional reason.
- Org admins and owners can end an active silence early.

Alert settings behavior:

- There is one notification delivery config per organization.
- Alert notification settings are configured only from the Alerts page.
- `everr apply <dir>` does not create, replace, or delete alert notification settings.
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
3. Expand the query template using validated, allowlisted query variables. In v1, this is only `${window}`.
4. Execute the query through the tenant-scoped ClickHouse path used by cloud SQL.
5. Normalize and bound returned rows into JSON evidence.
6. Render `summary` and `description` from the supported built-in variables and evidence-derived `${top_<column>}` variables.
7. If rows are non-empty and previous state is inactive or resolved, create a firing event.
8. If rows are non-empty and previous state is firing, update `last_seen_at`, row count, and evidence snapshot.
9. If rows are empty and previous state is firing, create a resolved event.
10. Insert a row into ClickHouse `alert_events` for firing, resolved, and evaluation-failed events.
11. Dispatch notifications through the current alert notification delivery settings unless an active silence suppresses delivery.

SQL/runtime errors:

- Do not change firing/resolved state.
- Update `last_evaluation_error` on the rule.
- Create an `evaluation_failed` event visible in the rule page.
- Use Graphile Worker retry behavior for transient failures where appropriate.

Retention:

- ClickHouse `alert_events` and bounded evidence are retained for the tenant's logs retention window.
- Current alert state is retained while the definition remains active.
- Graphile Worker job cleanup must stay bounded, while ClickHouse `alert_events` remains the authoritative history for the tenant's logs retention window.

## Notification Delivery

Notification delivery is driven by the single organization alert settings config, not by per-alert routing lists.

MVP delivery targets:

- Email through Resend.
- Telegram messages to configured chat IDs.

Delivery behavior:

- Firing events deliver according to the current saved alert settings.
- Resolved events are recorded in alert history and may be delivered if the saved settings enable resolution delivery.
- Before sending a notification, delivery checks for an active silence on the alert.
- A silence is active when `starts_at <= now()`, `ends_at > now()`, and `cancelled_at` is unset.
- Active silences suppress notifications only. Evaluations, state transitions, current evidence, and ClickHouse `alert_events` continue.
- When delivery is suppressed by a silence, no email or Telegram message is sent and ClickHouse `alert_events` records delivery outcome `silenced`.
- No catch-up notification is sent when a silence expires.
- Delivery failures do not change alert firing/resolved state.
- Delivery attempts and failures are recorded in ClickHouse `alert_events`.
- The Alerts page reads persisted current state and ClickHouse event history instead of depending on delivery payload retention.
- CI failure notifications keep their existing payload and UI path.

## Storage Model

Postgres tables:

- `alert_definitions`
  - `id`: internal alert definition ID.
  - `organization_id`: tenant/org owner.
  - `repoid`: stable repo identifier from `everr.yml`.
  - `slug`: alert name from `metadata.name`.
  - Unique key is `(organization_id, repoid, slug)`.
  - `evaluation_interval_seconds`: parsed `spec.evaluationInterval`.
  - `window`: validated alert window, stored in canonical form.
  - `raw_yaml`: original YAML fragment for display and debugging.
  - `parsed_query`: validated ClickHouse SQL template.
  - `summary_template`: required summary template.
  - `description_template`: optional description template.
  - `next_evaluation_at`: when the scanner should enqueue the next run.
  - `schedule_jitter_seconds`: stable per-alert jitter to avoid thundering herds.
  - `last_enqueued_at`: last time an evaluation job was queued.
  - `config_file_path`: relative path to the YAML file.
  - `source_link`: web URL back to repo/file/commit when available.
  - `created_at` and `updated_at`: normal audit timestamps.
  - `active`: false when removed by apply or deactivated from the web app.
  - `validation_status`: result of last apply-time validation.
  - `last_evaluation_status`: result of last runtime evaluation.
  - `last_evaluation_error`: latest query/runtime error text, if any.
  - `current_state`: current alert state, one of `unknown`, `resolved`, or `firing`.
  - `last_evaluated_at`: latest evaluation attempt time.
  - `last_fired_at`: when the alert most recently entered firing.
  - `last_resolved_at`: when the alert most recently resolved.
  - `last_seen_at`: latest time the alert was still firing.
  - `last_row_count`: count of violating rows from the latest successful evaluation.
  - `last_evidence_snapshot`: bounded latest evidence JSON for the alert detail page.
- `alert_settings`
  - One row per org with the notification delivery config JSON for email and Telegram.
- `alert_silences`
  - `id`: internal silence ID.
  - `organization_id`: tenant/org owner.
  - `alert_definition_id`: alert being silenced.
  - `starts_at`: when the silence starts.
  - `ends_at`: when the silence stops suppressing notifications.
  - `reason`: optional human-readable reason.
  - `created_by_user_id`: admin or owner who created the silence.
  - `created_at` and `updated_at`: normal audit timestamps.
  - `cancelled_at`: set when an admin or owner ends the silence early.
  - `cancelled_by_user_id`: admin or owner who ended the silence early.
  - Active-silence lookups filter by `organization_id`, `alert_definition_id`, `starts_at`, `ends_at`, and `cancelled_at`.

ClickHouse tables:

- `alert_events`
  - Append-only event history for firing, resolved, evaluation-failed, and delivery-attempt events.
  - `event_id` (`UUID`): generated event ID.
  - `organization_id` (`String`): tenant/org owner and the key used for tenant retention lookup. This must be `String`, not `UUID`, because Postgres organization IDs are text and the existing `app.tenant_retention` dictionary is keyed by `tenant_id String`; using `UUID` would make `dictGetOrDefault('app.tenant_retention', 'logs_days', organization_id, ...)` fail without an explicit cast.
  - `alert_definition_id` (`String`): ID of the alert definition that produced the event.
  - `repoid` (`String`): stable repo identifier from `everr.yml`, copied from the alert definition for history queries.
  - `slug` (`String`): alert name from `metadata.name`, copied from the alert definition for history queries.
  - `event_type` (`LowCardinality(String)`): event kind, such as `firing`, `resolved`, `evaluation_failed`, or `delivery_attempt`.
  - `evaluation_scheduled_at` (`DateTime64(3)`): scheduled evaluation timestamp for evaluator events, or the default zero timestamp for non-evaluator events.
  - `event_time` (`DateTime64(3)`): time the event was created; this is the TTL timestamp.
  - `event_date` (`Date DEFAULT toDate(event_time)`): date derived from `event_time`, used for monthly lifecycle partitioning.
  - `row_count` (`UInt32`): count of violating rows for evaluator events.
  - `evidence_truncated` (`UInt8` or `Bool`): whether evidence rows or JSON bytes were truncated.
  - `evidence_json` (`String`): bounded evidence JSON snapshot for the event.
  - `delivery_target_type` (`LowCardinality(String)`): delivery target kind for delivery attempts, such as `email` or `telegram`.
  - `delivery_outcome` (`LowCardinality(String)`): delivery result, such as `sent`, `failed`, or `silenced`.
  - `silence_id` (`String`): ID of the active silence that suppressed delivery, or the empty/default value when not silenced.
  - Use native ClickHouse types for typed values, except where existing app identifiers or dictionary keys are strings: UUIDs for generated event IDs, `String` for `organization_id`, Date/DateTime64 for dates and times, unsigned integers for row counts and truncation flags, and strings only for real string data.
  - Use `MergeTree`, partition by event month for lifecycle cleanup with `PARTITION BY toYYYYMM(event_date)`, and set TTL from the existing tenant log retention dictionary: `event_time + INTERVAL dictGetOrDefault('app.tenant_retention', 'logs_days', organization_id, toUInt32(3650)) DAY`.
  - Reuse the existing logs retention behavior, including the intentionally high fallback that over-retains instead of silently dropping data if the dictionary is unavailable.
  - Plan the `ORDER BY` before implementation around the dominant Alerts page read: per-alert history filtered by `organization_id`, `repoid`, `slug`, and a time range. A starting key is `(organization_id, repoid, slug, event_time, event_id)`.
  - Do not put `event_date` before `repoid` and `slug` in the initial `ORDER BY` unless org-wide date browsing becomes the dominant query. Monthly `PARTITION BY toYYYYMM(event_date)` already handles lifecycle cleanup and coarse time pruning; putting `event_date` second would make `repoid` and `slug` less useful for sparse-index pruning across longer ranges. This choice must be finalized before table creation because ClickHouse `ORDER BY` is immutable.
  - Use `LowCardinality(String)` for bounded strings such as event type, delivery target type, and delivery outcome.
  - Avoid `Nullable` unless the value has real null semantics; use empty strings, zeros, and empty JSON objects for absent optional values.
  - Buffer or async-insert alert events so the evaluator does not create one ClickHouse part per alert event under load.
- `alert_events_logs_mv`
  - Materialized view from `app.alert_events` into `app.logs`.
  - Makes alert events queryable through the existing logs path, including `everr cloud query`.
  - Does not make `app.logs` the canonical alert history store; the Alerts page reads `app.alert_events` directly for alert-specific history.
  - Must explicitly project the real `app.logs.tenant_id` column as `tenant_id = organization_id`. `app.logs` RLS and TTL use the top-level `tenant_id` column, not `ResourceAttributes['everr.tenant.id']`; without this projection, alert log rows would be invisible to tenant-scoped queries and would not use tenant log retention correctly.
  - Projects `event_time` into `Timestamp` and `TimestampTime`.
  - Uses `ServiceName = 'alert'`.
  - Uses `EventName = 'everr.alert.' || event_type`.
  - Uses a concise human-readable `Body` derived from `event_type` and `slug`.
  - Stores alert identifiers, delivery metadata, and bounded evidence metadata in `LogAttributes`, including `alert.definition_id`, `alert.repoid`, `alert.slug`, `alert.event_type`, `alert.delivery_outcome`, `alert.silence_id`, `alert.row_count`, `alert.evidence_truncated`, and `alert.evidence_json`.
  - Also keeps `ResourceAttributes['everr.tenant.id']` aligned with `organization_id` for consistency with other log rows.
  - Leaves trace/span fields empty or defaulted because alert events are operational events, not trace-attached logs.

Do not generate Drizzle migrations until implementation reaches the migration step requested by the user. Schema work first updates Drizzle definitions only.

## Module Boundaries

Add alerting code under focused modules:

- `packages/app/src/server/alerts/`
  - Graphile Worker task registration for the shared runner, due-alert scanner, evaluation worker, alert variable expansion, state transitions, notification delivery, ClickHouse alert event insertion, and cleanup.
- `packages/app/src/data/alerts/`
  - Web server functions and data loaders.
- `packages/app/src/routes/api/cli/alerts/*`
  - CLI test endpoints.
- Shared apply modules and routes
  - Alert resource registry, apply auth, planning, confirmation, and reconciliation.
- `packages/app/src/db/notify.ts` and `packages/app/src/db/notification-hub.ts`
  - Keep CI workflow notification behavior intact.
- `packages/desktop-app/src-cli`
  - `alerts test` command and shared `apply` support for alert resources.
- `packages/app/src/lib/mailer.server.ts`
  - Reuse Resend mailer infrastructure for email alert delivery.

## Bounds And Auditability

Query evidence is bounded at every boundary:

- Store at most 50 evidence rows per alert evaluation.
- Store at most 64 KiB of evidence JSON per alert event/state snapshot.
- CLI output must stay under the existing CLI guideline target of about 30 KiB for normal use by summarizing row counts and truncation status before printing evidence.
- Alert detail views show whether evidence was truncated.

Alert apply auditability:

- Store `created_at` and `updated_at` on alert definitions.
- Store the config file path, source link, and git-derived repo, branch, commit SHA, and remote when available.
- Show the source link in the web rule page.
- Org admins and owners can deactivate any alert rule from the web app, even though any member can apply.

## Testing

Unit tests:

- `everr.yml` and alert resource YAML schema validation.
- Alert schema validation uses the same Zod validation pipeline as dashboard schema validation.
- Window parsing and alert variable expansion.
- Template rendering.
- Alert settings UI input validation.
- Alert state transitions.
- Active silence detection.
- Evidence row bounding.
- ClickHouse alert event row construction.
- ClickHouse `alert_events` schema definition uses `organization_id String`, `event_date Date DEFAULT toDate(event_time)`, `MergeTree`, `PARTITION BY toYYYYMM(event_date)`, logs-retention TTL, and `ORDER BY (organization_id, repoid, slug, event_time, event_id)`.
- Alert event row construction only includes `raw_yaml` on firing and resolved transition events.
- `alert_events_logs_mv` maps alert event rows into the existing `app.logs` schema, including top-level `tenant_id = organization_id` for RLS and TTL and `LogAttributes` entries for `alert.row_count`, `alert.evidence_truncated`, and `alert.evidence_json`.

API route tests:

- Apply authentication for both `INGEST_TOKEN` and `SESSION_TOKEN`.
- Cloud test authentication.
- Member apply permission.
- Apply request validation for a complete `state` payload containing dashboards and alerts.
- Apply rejects `AlertSettings` YAML resources.
- Alert settings web API validation.
- Alert silence create and cancel authorization.
- Alert silence create and cancel audit fields are persisted.
- Query validation success and failure.
- Upsert semantics by `(organization_id, repoid, slug)`.
- Apply diff semantics for add, update, and remove.

Graphile Worker/evaluator tests:

- Firing transition.
- Repeated firing update.
- Resolution transition.
- Evaluation failure does not change active state.
- Scanner claims due alerts and advances `next_evaluation_at`.
- Two worker processes sharing one Postgres database do not double-enqueue or double-apply the same alert evaluation.
- Queue retry behavior records evaluation failure without changing firing state.
- Evaluation events are inserted into ClickHouse `alert_events`.
- Silenced firing events update alert state and evidence without sending notifications.
- Load-oriented test covers a large due set by batching scanner claims.

CLI tests:

- Parser/help output.
- Cloud default and `--local` targeting.
- `everr.yml` `repoid` parsing and validation.
- Alert YAML resource discovery in an apply directory.
- Dashboard and alert state payload construction for `everr apply <dir>`.
- `everr cloud query` can query projected alert events through `app.logs`.
- Mocked apply/test API calls.
- JSON output includes applied options.

Desktop tests:

- Alerting changes do not break existing CI failure notifications.

Notification delivery tests:

- Firing events use the saved alert delivery config.
- Resend email delivery is invoked for configured email recipients.
- Telegram delivery is invoked for configured chat IDs.
- Active silences suppress email and Telegram delivery.
- Silenced delivery attempts insert ClickHouse `alert_events` rows with delivery outcome `silenced`.
- Delivery failures are logged without changing firing/resolved state.
- Delivery attempts and failures insert ClickHouse `alert_events` rows.

## Validated Risk Status

- Redis/BullMQ: rejected. Redis is not acceptable for this system.
- DBOS inside the TanStack/Vite server build: rejected. DBOS docs say DBOS and workflows cannot be bundled by Vite/Rollup/esbuild and must be external.
- Workflow SDK: not chosen for v1. The Postgres World is viable, but it adds workflow transforms, workflow storage, framework endpoints, and workflow history around a workload that is fundamentally scheduled query evaluation. The Postgres World also uses Graphile Worker underneath, so direct queueing is the simpler scaling path.
- Graphile Worker: chosen for v1 orchestration and scheduling. It is already used by the GitHub event worker, keeps the runtime Postgres-backed, and avoids a separate queue service. Alert tasks register in the same v1 runner as GitHub event tasks.
- `pg-boss`: rejected and not present in the app dependencies. Alerting must not introduce it.
- Per-alert runtime cron schedules: rejected for scale. At 5,000 alerts per minute, app-owned due-time scanning is a better shape than thousands of dynamic cron entries.
- Multiple worker replicas: accepted with required verification. Graphile Worker distributes claimed jobs through Postgres-backed locking, and the scanner additionally uses app-table row locks. Implementation must run a two-process integration test against one Postgres database.
- 5,000 alerts per minute: partially validated. Queue throughput should not be the primary bottleneck; ClickHouse query concurrency and cost are. Implementation must load test scanner batching and evaluation concurrency before treating this capacity target as satisfied.
- Queue retention: resolved by design. Keep Graphile Worker job cleanup bounded, while ClickHouse `alert_events` remains the authoritative history for the tenant's logs retention window.
- Query result bounds: resolved by design. Evidence row and byte limits are mandatory.
- Member apply risk: accepted product risk with mitigations. Any member can apply, but source links, applier metadata, and admin/owner deactivation make changes auditable and reversible.
- Alert history persistence: resolved by design. Current state remains in Postgres, while event history is stored in ClickHouse `alert_events`.
- Alert event queryability: resolved by design. `alert_events_logs_mv` projects alert events into `app.logs` for `everr cloud query`, including top-level `tenant_id = organization_id` for `app.logs` RLS and TTL, while `app.alert_events` remains canonical for alert-specific history.

## Approved Decisions

- Free-form Grafana-style alert rules, not SLO/SLI.
- One SQL query per alert.
- The query returns violating rows.
- One alert instance per rule.
- Non-empty query result fires; empty result resolves.
- Use Everr `${name}` alert variable notation, including `${window}` derived from `window`.
- Require `summary`; allow optional `description`.
- Remove root `service`; alert ownership is repo-scoped through `repoid`.
- Use `everr.yml` with only `repoid` plus ordinary YAML resource files in an apply directory.
- Identify alerts by `(organization_id, repoid, slug)` using `everr.yml` and `metadata.name`.
- Validate apply by running each query against cloud.
- Do not include alert severity in v1.
- Use one organization alert settings config for notification delivery.
- Configure alert notification settings only through the web UI; YAML/apply does not manage notification settings.
- Support email through Resend and Telegram in the MVP delivery config.
- Persist alert event history in ClickHouse `alert_events`.
- Project alert events into `app.logs` through a materialized view so they are queryable through `everr cloud query`.
- Support bounded operational alert silences that suppress delivery but do not stop evaluation or state updates.
- Any org member can apply alert YAML.
- `everr apply <dir>` sends one `state` payload containing dashboards and alerts, then applies the diff for add, update, and remove.
- Apply accepts `SESSION_TOKEN` and `INGEST_TOKEN`, echoes the resolved destination organization, and requires confirmation before destructive writes.
- Use Graphile Worker for alert orchestration and scheduling.
- Use app-owned due-time scanning instead of one runtime schedule per alert.
- Support multiple app/worker replicas with Postgres-backed queueing and app-level idempotency.
