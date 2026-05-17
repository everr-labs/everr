# GitHub Deploy CDEvents Ingest Design

## Status

Approved for implementation planning.

## Context

Everr currently ingests GitHub Actions `workflow_run` and `workflow_job` webhooks. The app verifies GitHub webhooks, resolves the tenant through the GitHub App installation, queues each event through pg-boss, writes workflow status to Postgres, and forwards CI telemetry to the collector so it lands in ClickHouse.

Deploy tracking should start with GitHub's native `deployment` and `deployment_status` webhook events. Users who already use GitHub Actions environments or the GitHub Deployments API can adopt this without adding an Everr-specific action step.

For v1, deployment events should be stored as OpenTelemetry logs with a CDEvents-shaped JSON body. There is no Postgres deploy table in v1. ClickHouse is the source for deploy history and deploy queries.

## Goals

- Accept GitHub `deployment` and `deployment_status` webhooks.
- Convert those webhooks into OTel log records.
- Store deploy events in the existing ClickHouse logs path.
- Shape each log body as a CDEvents-style event so the event model is not GitHub-only.
- Add query-friendly log attributes for common deploy filters.
- Keep the first version small enough to support GitHub-native deploy tracking without custom YAML beyond GitHub environments.

## Non-Goals

- Do not add Postgres deploy state in v1.
- Do not add a custom ClickHouse `deploy_events` table in v1.
- Do not add `everr/action` deploy marker inputs in this slice.
- Do not build deploy UI in this slice.
- Do not try to infer deploys from workflow names.
- Do not capture GitHub Actions environment usage that does not create a GitHub Deployment object, such as jobs configured with `environment.deployment: false`.
- Do not generate Drizzle migrations as part of the design step.

## Event Model

Each accepted GitHub deploy webhook becomes one or more OTel log records.

The log body is JSON with a CDEvents-style shape:

```json
{
  "context": {
    "version": "0.5.0",
    "id": "github-delivery-id",
    "source": "github.com/acme/api",
    "type": "dev.cdevents.service.deployed.0.3.0",
    "timestamp": "2026-05-17T10:30:00.000Z"
  },
  "subject": {
    "id": "github-deployment-123456",
    "source": "github.com/acme/api",
    "content": {
      "environment": {
        "id": "production",
        "name": "production"
      },
      "artifactId": "pkg:github/acme/api@abc123"
    }
  }
}
```

## CDEvents Version Pin

V1 pins the body to CDEvents spec `0.5.0` and this event type subset:

- `dev.cdevents.pipelinerun.queued.0.3.0`
- `dev.cdevents.pipelinerun.started.0.3.0`
- `dev.cdevents.pipelinerun.finished.0.3.0`
- `dev.cdevents.service.deployed.0.3.0`

For CDEvents records, the `context.version` field must be `0.5.0`, and the `context.type` field must use one of the exact event types above. Do not silently move to a newer CDEvents spec or event type version later; that is an ingestion format change and needs an explicit migration or dual-read plan.

`everr.deploy.superseded` is an Everr custom OTel log event, not part of the pinned CDEvents subset. Set its OTel `EventName` to `everr.deploy.superseded` and leave `cdevents.type` empty.

The exact CDEvents event type depends on the GitHub event:

| GitHub event | GitHub state | CDEvents-style log event |
| --- | --- | --- |
| `deployment` | created/requested | `dev.cdevents.pipelinerun.queued.0.3.0` |
| `deployment_status` | `in_progress` | `dev.cdevents.pipelinerun.started.0.3.0` |
| `deployment_status` | `success` | `dev.cdevents.pipelinerun.finished.0.3.0` and `dev.cdevents.service.deployed.0.3.0` |
| `deployment_status` | `failure` or `error` | `dev.cdevents.pipelinerun.finished.0.3.0` |
| `deployment_status` | `inactive` | `everr.deploy.superseded` custom OTel log event |

Do not map GitHub `inactive` to a CDEvents `service.removed` event. In GitHub, `inactive` usually means an older deployment was superseded by a newer one, not that the service stopped running.

For `deployment_status: success`, emit both:

1. a pipeline completion event, because the deployment run finished; and
2. a service deployed event, because the service is now running in the environment.

## Query Attributes

The CDEvents JSON body is useful for portability, but common filters should not require JSON parsing. Duplicate important fields into OTel log attributes:

- `cdevents.type`
- `cdevents.id`
- `cicd.pipeline.name`
- `cicd.pipeline.result`
- `cicd.pipeline.run.id`
- `cicd.pipeline.run.state`
- `deployment.environment.name`
- `vcs.repository.name`
- `vcs.repository.url.full`
- `vcs.ref.head.revision`
- `everr.deploy.id`
- `everr.deploy.service.name`
- `everr.deploy.status`
- `everr.deploy.url`
- `everr.github.repository.full_name`
- `everr.github.repository.owner.login`
- `everr.github.deployment_status.id`
- `everr.github.deployment.creator.login`
- `everr.github.workflow_run.id`
- `everr.github.workflow_run.run_attempt`

Set the OTel log record event name with `SetEventName(...)`, so ClickHouse stores it in the dedicated `EventName` column. Do not also write `event.name` into `LogAttributes`.

Keep custom attributes under `everr.*`. Use standard OTel attributes only when the attribute already has the same meaning, such as `deployment.environment.name` and `vcs.ref.head.revision`.

Use `ServiceName = 'github-deployments'` for the OTel resource service name and ClickHouse column. Use `everr.deploy.service.name` for the service being deployed.

Map OTel CI/CD attributes when they fit the GitHub deployment lifecycle:

- `cicd.pipeline.run.id`: GitHub deployment id.
- `cicd.pipeline.name`: GitHub deployment task, defaulting to `deploy`.
- `cicd.pipeline.run.state`: `pending` for deployment creation, `executing` for `in_progress`.
- `cicd.pipeline.result`: `success`, `failure`, or `error` on finished deployment status events.

Use `everr.github.repository.full_name` for GitHub's `owner/repo` value because OTel `vcs.repository.name` is only the repository name.

Use empty strings for missing optional fields instead of nullable values.

## Resource Attributes

Every deploy log record must be emitted under an OTel resource. These attributes are required on `ResourceAttributes`, not just on individual log records:

- `everr.tenant.id`: the tenant id resolved from the GitHub App installation. This is required because `app.logs_mv` copies `ResourceAttributes['everr.tenant.id']` into `app.logs.tenant_id`.
- `service.name`: `github-deployments`. The ClickHouse exporter copies this into the `ServiceName` column, which deploy queries use for the primary filter.
- `deployment.environment.name`: GitHub deployment environment name.
- `vcs.repository.name`: repository name only, such as `api`.
- `vcs.repository.url.full`: canonical repository URL, such as `https://github.com/acme/api`.
- `everr.github.repository.full_name`: GitHub full repository name, such as `acme/api`.
- `everr.github.repository.owner.login`: repository owner or organization login.

Do not use `vcs.owner.name` or `vcs.provider.name`; they are not in the OTel VCS semantic conventions. Keep those GitHub-specific fields under `everr.github.*`.

Set the `ResourceLogs.SchemaUrl` to the OTel semantic convention schema URL used by the receiver, for example `https://opentelemetry.io/schemas/1.38.0` while the receiver uses semconv v1.38.0.

If one GitHub webhook emits multiple log records, such as `deployment_status: success`, put those records under the same resource so they share the tenant, storage service, environment, and repository identity.

## Trace Linkage

If a `deployment` or `deployment_status` payload includes GitHub `workflow_run` data, set each emitted deploy log record's OTel `TraceID` to the same deterministic trace id used by workflow telemetry:

```text
generateTraceID(repository.id, workflow_run.id, workflow_run.run_attempt)
```

This links deploy logs to the CI trace for queries and trace views. It uses the existing receiver trace id shape from workflow logs and spans.

Only set this trace id when `repository.id`, `workflow_run.id`, and `workflow_run.run_attempt` are all present. If the webhook does not include workflow run linkage, leave the deploy log `TraceID` empty in v1. Do not call the GitHub API just to discover missing linkage.

Also copy the linkage into log attributes:

- `everr.github.workflow_run.id`
- `everr.github.workflow_run.run_attempt`

## Data Flow

1. GitHub sends `deployment` or `deployment_status` to Everr's existing `/webhook/github` route.
2. The webhook route verifies the signature and keeps ignoring unsupported events.
3. The allowlist expands to accept `deployment` and `deployment_status`.
4. The existing event queue stores the raw payload once and sends it to the worker path.
5. The tenant resolver uses `installation.id`, the same as workflow events.
6. The app forwards the raw webhook payload and resolved tenant id to the collector through the existing `gh-collector` path.
7. The collector's GitHub Actions receiver accepts `deployment` and `deployment_status` events in addition to workflow events.
8. A new deploy event mapper in the collector parses the GitHub payload and builds OTel log records.
9. The collector exports the logs into ClickHouse.
10. Query surfaces can find deploys by filtering `app.logs`.

The existing `gh-status` Postgres-writing path remains workflow-only. Deployment events do not create Postgres rows in v1.

The collector dispatch must keep deploy mapping structurally separate from the existing workflow log path. `eventToLogs` is workflow-run specific: it expects a `WorkflowRunEvent` and fetches a GitHub Actions log archive with an installation GitHub client. Deploy webhooks do not have an archive to fetch. Add a deploy-specific mapper, for example `deploymentEventToLogs`, and dispatch `deployment` and `deployment_status` before the workflow trace, metric, and log archive logic. The deploy path must not call `getInstallationClient()` or `Actions.GetWorkflowRunAttemptLogs(...)`.

## ClickHouse Query Shape

Deploy history queries read from `app.logs`:

```sql
SELECT
  TimestampTime,
  EventName AS event_name,
  LogAttributes['deployment.environment.name'] AS environment,
  LogAttributes['everr.deploy.status'] AS status,
  LogAttributes['everr.deploy.service.name'] AS service,
  LogAttributes['everr.github.repository.full_name'] AS repository,
  LogAttributes['vcs.ref.head.revision'] AS sha,
  Body
FROM app.logs
WHERE ServiceName = 'github-deployments'
  AND TimestampTime >= now() - INTERVAL 7 DAY
  AND (startsWith(EventName, 'dev.cdevents.') OR EventName = 'everr.deploy.superseded')
ORDER BY TimestampTime DESC
LIMIT 100;
```

The existing `app.logs` table orders by tenant, service, and time. That is a reasonable v1 fit if deploy logs use a stable service name such as `github-deployments`. It keeps deploy queries time-bounded and service-filtered.

Per `query-mv-incremental`, remember that `app.logs_mv` transforms inserted `otel.otel_logs` rows as they arrive. That means `everr.tenant.id` must already be present on `ResourceAttributes` before insert time. Per `schema-pk-filter-on-orderby`, keep deploy queries anchored on the existing `ORDER BY` prefix through the tenant row policy, `ServiceName`, and time. `EventName` is cheaper to read than `LogAttributes['event.name']`, but it is not part of the `ORDER BY`, so it should not replace the service and time filters. Per `query-index-skipping-indices`, do not add a skipping index for `EventName` in v1; consider it later only if real deploy queries are hot and `EXPLAIN indexes = 1` shows useful skipping.

Per `schema-pk-plan-before-creation`, avoid creating a custom deploy table until the query patterns are better proven, because ClickHouse `ORDER BY` is hard to change later. Per `schema-pk-prioritize-filters`, if a custom table is added later, its key should be driven by the most common filters: tenant, environment, service, repository, and time. Per `schema-types-lowcardinality`, repeated strings like environment, status, service, and event name should be LowCardinality if they become typed columns later. Per `schema-types-avoid-nullable`, optional fields should prefer empty defaults over nullable columns.

Do not add `tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))` to queries. Existing row-level policy handles tenant filtering.

## Error Handling

- Invalid JSON or unsupported deploy payload shape is a terminal event error and should not retry.
- Missing `installation.id` is terminal because Everr cannot resolve a tenant.
- Missing deployment id, repo, or SHA should not crash if GitHub allows the payload; emit the log with empty query attributes and preserve the raw CDEvents body where possible.
- Collector or ClickHouse failures remain retryable through the existing queue behavior.
- Duplicate GitHub delivery ids should stay idempotent through the existing pg-boss job id behavior.

## Deployment Phases

CDEvents does not model deploy phases as one `phase` field on `service.deployed`. Richer phases should be modeled as task runs:

- `dev.cdevents.taskrun.started.0.3.0`
- `dev.cdevents.taskrun.finished.0.3.0`

GitHub native deployment events do not provide phase detail like `migrate`, `canary`, `rollout`, or `verify`. That should be a later `everr/action` feature. When added, Everr can emit task-run CDEvents and include a query-friendly attribute such as `everr.deploy.phase`.

## Testing

- Webhook tests:
  - accepts `deployment`
  - accepts `deployment_status`
  - still ignores unrelated GitHub events
  - still rejects bad signatures
- Payload parser tests:
  - parses minimal GitHub deployment payloads
  - parses minimal GitHub deployment status payloads
  - rejects missing installation id
- Mapper tests:
  - maps `deployment` to a pipeline event
  - maps `deployment_status: in_progress` to pipeline started
  - maps `deployment_status: success` to pipeline finished plus service deployed
  - maps `deployment_status: failure` and `error` to pipeline finished with failure
  - maps `deployment_status: inactive` to `everr.deploy.superseded`, not service removed
  - uses `context.version = "0.5.0"` and only the pinned CDEvents `0.3.0` event types
  - preserves repository, SHA, environment, URL, and sender fields as log attributes
  - sets the OTel `EventName` field instead of writing `event.name` to `LogAttributes`
  - sets resource attributes for tenant id, storage service name, environment, and repository identity
  - sets `ResourceLogs.SchemaUrl`
  - sets the same `TraceID` as workflow telemetry when `workflow_run` linkage is present
  - leaves `TraceID` empty when workflow linkage is absent
- Receiver dispatch tests:
  - deploy events use the deploy mapper before the workflow log path
  - deploy events do not require an installation GitHub client
  - deploy events do not call `GetWorkflowRunAttemptLogs`
- ClickHouse query tests:
  - deploy logs can be selected from `app.logs` using service name, event name, environment, and time filters
  - deploy logs include `app.logs.tenant_id` through `ResourceAttributes['everr.tenant.id']`
- End-to-end smoke:
  - send signed GitHub-like deployment payloads to `/webhook/github`
  - verify deploy CDEvents-shaped logs appear in ClickHouse

## References

- CDEvents documentation: https://cdevents.dev/docs/
- CDEvents primer and observability use case: https://cdevents.dev/docs/primer/
- GitHub Actions environment deployment tracking: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments
- GitHub deployment webhooks: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- GitHub deployment statuses API states: https://docs.github.com/en/rest/deployments/statuses
