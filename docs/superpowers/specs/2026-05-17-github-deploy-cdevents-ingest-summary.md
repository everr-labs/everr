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
| `deployment` | created/requested | `dev.cdevents.pipelinerun.queued.*` |
| `deployment_status` | `in_progress` | `dev.cdevents.pipelinerun.started.*` |
| `deployment_status` | `success` | `dev.cdevents.pipelinerun.finished.*` plus `dev.cdevents.service.deployed.*` |
| `deployment_status` | `failure` or `error` | `dev.cdevents.pipelinerun.finished.*` |
| `deployment_status` | `inactive` | `everr.deploy.superseded` custom OTel log event |

On successful deploys, emit both a pipeline finished event and a service deployed event. The first says the deploy process completed; the second says the service is now deployed.

Do not map GitHub `inactive` to `service.removed`. GitHub usually marks an old deployment inactive when a newer one supersedes it, while the service can still be running.

## Query Attributes

Each log should include these attributes so SQL queries do not need to parse JSON:

- `cdevents.type`
- `cdevents.id`
- `deployment.environment.name`
- `vcs.repository.name`
- `vcs.ref.head.revision`
- `everr.deploy.id`
- `everr.deploy.service.name`
- `everr.deploy.status`
- `everr.deploy.url`
- `everr.github.deployment_status.id`
- `everr.github.deployment.creator.login`

Set the OTel log record event name with `SetEventName(...)`. ClickHouse stores it in the dedicated `EventName` column, so do not duplicate it as `event.name` inside `LogAttributes`.

Keep custom deploy fields under `everr.*`. Use standard OTel fields only when they already mean the same thing.

Use `ServiceName = 'github-deployments'` for storage and `everr.deploy.service.name` for the service being deployed.

Use empty strings for optional missing values.

## Data Flow

1. GitHub sends `deployment` or `deployment_status` to `/webhook/github`.
2. The app verifies the webhook signature.
3. The app resolves the tenant from `installation.id`.
4. The raw webhook is queued and forwarded through the existing collector path.
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
- No detailed phase tracking from GitHub alone.

## Later Extension

GitHub native deploy events do not include detailed phases like `migrate`, `canary`, `rollout`, or `verify`.

When we add Everr-specific deploy markers, phases should be represented as CDEvents task-run logs:

- `dev.cdevents.taskrun.started.*`
- `dev.cdevents.taskrun.finished.*`

Those logs can also include `everr.deploy.phase` for easy filtering.
