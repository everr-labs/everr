# GitHub Deploy CDEvents Ingest Summary

## Purpose

Add first-class deploy event ingestion for users who already use GitHub Deployments or GitHub Actions environments.

V1 tracks deploy history in ClickHouse only. It does not add a Postgres deploy table.

## Core Design Choices

1. **Use GitHub native deploy webhooks**

   Accept `deployment` and `deployment_status` events in the existing GitHub webhook route.

2. **Store deploys as OTel logs**

   Convert each deploy webhook into one or more OpenTelemetry log records. The log body is a CDEvents-shaped JSON event. Common query fields are duplicated into log attributes.

3. **Use existing ClickHouse logs storage**

   Deploy events land in the existing `app.logs` path. V1 does not create a custom `deploy_events` table.

4. **Keep Postgres workflow state unchanged**

   The existing `gh-status` path remains workflow-only. Deploy webhooks do not write Postgres rows in v1.

5. **Keep the model standards-shaped**

   CDEvents gives us a deploy event shape that is not tied only to GitHub. Later, `everr/action` can emit the same event shape for richer deploy phases.

## Event Mapping

| GitHub event | GitHub state | OTel log event |
| --- | --- | --- |
| `deployment` | created/requested | `dev.cdevents.pipelinerun.queued.0.3.0` |
| `deployment_status` | `in_progress` | `dev.cdevents.pipelinerun.started.0.3.0` |
| `deployment_status` | `success` | `dev.cdevents.pipelinerun.finished.0.3.0` plus `dev.cdevents.service.deployed.0.3.0` |
| `deployment_status` | `failure` or `error` | `dev.cdevents.pipelinerun.finished.0.3.0` |
| `deployment_status` | `inactive` | `everr.deploy.superseded` custom OTel log event |

On successful deploys, emit both a pipeline finished event and a service deployed event. The first says the deploy process completed; the second says the service is now deployed.

Do not map GitHub `inactive` to `service.removed`. GitHub usually marks an old deployment inactive when a newer one supersedes it, while the service can still be running.

Pin CDEvents output to `context.version = "0.5.0"` and the exact `0.3.0` event types above. Changing the CDEvents spec or event type versions later is an ingestion format change. `everr.deploy.superseded` is a custom OTel log event outside that CDEvents subset, so it leaves `cdevents.*` attributes empty.

For CDEvents records, `cdevents.id` equals the CDEvents body `context.id`. Use GitHub's `x-github-delivery` header as the base id. If one webhook emits two CDEvents records, as `deployment_status: success` does, the second record must get a distinct id: `<x-github-delivery>-service-deployed`. Keep the raw delivery id in `everr.github.delivery.id` on every deploy row.

## Query Attributes

CDEvents log records should include these event-specific attributes so SQL queries do not need to parse JSON:

- `cdevents.type`
- `cdevents.id`
- `everr.github.delivery.id`
- `cicd.pipeline.name`
- `cicd.pipeline.result`
- `cicd.pipeline.run.id`
- `cicd.pipeline.run.state`
- `vcs.ref.head.revision`
- `vcs.ref.head.name`
- `everr.deploy.id`
- `everr.deploy.service.name`
- `everr.deploy.status`
- `everr.deploy.url`
- `everr.github.deployment_status.id`
- `everr.github.deployment.creator.login`
- `everr.github.workflow_run.id`
- `everr.github.workflow_run.run_attempt`

Repository identity is resource-level data, so queries should read it from `ResourceAttributes`.

Set the OTel log record event name with `SetEventName(...)`. ClickHouse stores it in the dedicated `EventName` column, so do not duplicate it as `event.name` inside `LogAttributes`.

Keep custom deploy fields under `everr.*`. Use standard OTel fields only when they already mean the same thing.

Use `ServiceName = 'github-deployments'` for storage and `everr.deploy.service.name` for the service being deployed. Query environment from `ResourceAttributes['deployment.environment.name']`, not from log attributes.

Use `cicd.pipeline.run.id` for the GitHub deployment id, `cicd.pipeline.name` for the deployment task, `cicd.pipeline.run.state` for pending/executing, and `cicd.pipeline.result` for success/failure/error.

Set `everr.deploy.id` to the same GitHub deployment id string used by `cicd.pipeline.run.id`. It duplicates the id under the `everr.*` namespace so future `everr/action` task-run or phase events have a stable Everr-owned deploy join key without depending on OTel CI/CD semantic convention evolution.

Use `everr.github.repository.full_name` for GitHub's `owner/repo` value because OTel `vcs.repository.name` is only the repository name.

Use empty strings for optional missing values.

## Resource Attributes

Each deploy log must also set resource-level data:

- `everr.tenant.id`: resolved tenant id from the GitHub App installation
- `service.name`: `github-deployments`
- `deployment.environment.name`
- `vcs.repository.name`: repository name only
- `vcs.repository.url.full`
- `everr.github.repository.full_name`
- `everr.github.repository.owner.login`

Set `ResourceLogs.SchemaUrl` to the OTel semantic convention schema URL used by the receiver. This matters because `app.logs_mv` reads the tenant from `ResourceAttributes['everr.tenant.id']`.

## Trace Linkage

When the parsed GitHub payload includes `workflow_run`, set the deploy log `TraceID` with the existing workflow formula: `generateTraceID(repository.id, workflow_run.id, workflow_run.run_attempt)`.

In go-github v67.0.0, `DeploymentEvent` exposes `WorkflowRun`, but `DeploymentStatusEvent` does not. If the parsed event does not expose workflow run linkage, leave `TraceID` empty in v1. Do not call the GitHub API just to fill it in.

## Data Flow

1. GitHub sends `deployment` or `deployment_status` to `/webhook/github`.
2. The app verifies the webhook signature.
3. The app resolves the tenant from `installation.id`.
4. The raw webhook and resolved tenant id are queued and forwarded through the existing collector path.
5. The collector accepts deploy webhooks and maps them into OTel logs.
6. The collector exports those logs to ClickHouse.
7. Deploy history is queried from `app.logs`.

Implementation detail: deploy mapping must be a separate collector path from workflow log archive ingestion. The existing workflow log mapper expects a `workflow_run` event and fetches a GitHub Actions log archive with an installation client. Deploy events should map directly from webhook payload to logs and should not call the GitHub Actions log API.

## Non-Goals

- No Postgres deploy table in v1.
- No custom ClickHouse deploy table in v1.
- No deploy UI in this slice.
- No `everr/action` deploy marker inputs in this slice.
- No deploy inference from workflow names.
- No capture for GitHub Actions environment usage that does not create a GitHub Deployment object, such as `environment.deployment: false`.
- No detailed phase tracking from GitHub alone.

## Later Extension

GitHub native deploy events do not include detailed phases like `migrate`, `canary`, `rollout`, or `verify`.

When we add Everr-specific deploy markers, phases should be represented as CDEvents task-run logs:

- `dev.cdevents.taskrun.started.0.3.0`
- `dev.cdevents.taskrun.finished.0.3.0`

Those logs can also include `everr.deploy.phase` for easy filtering.

## Standards Links

The summary follows these standards contracts:

- OTel logs data model for `Body`, `Resource`, `Attributes`, `TraceId`, and `EventName`: https://opentelemetry.io/docs/specs/otel/logs/data-model/
- OTel custom attribute naming, which is why Everr-specific fields stay under `everr.*`: https://opentelemetry.io/docs/specs/semconv/general/naming/
- OTel resource/service conventions for `service.name`: https://opentelemetry.io/docs/specs/semconv/resource/
- OTel deployment attributes for `deployment.environment.name`: https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/
- OTel CI/CD attributes for `cicd.pipeline.*`: https://opentelemetry.io/docs/specs/semconv/registry/attributes/cicd/
- OTel VCS attributes for `vcs.repository.name`, `vcs.repository.url.full`, and `vcs.ref.head.revision`: https://opentelemetry.io/docs/specs/semconv/registry/entities/vcs/
- CDEvents v0.5.0 docs and event versioning model: https://cdevents.dev/docs/ and https://cdevents.dev/docs/primer/#versioning-of-cdevents
- CloudEvents `source + id` uniqueness rule inherited by CDEvents context ids: https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md#id
- CDEvents Go SDK v0.5 schema surface used to pin event types to `0.3.0`: https://pkg.go.dev/github.com/cdevents/sdk-go/pkg/api/v05
