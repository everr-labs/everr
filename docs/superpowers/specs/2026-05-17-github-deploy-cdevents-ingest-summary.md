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
| `deployment_status` | `inactive` | `dev.cdevents.service.removed.*` |

On successful deploys, emit both a pipeline finished event and a service deployed event. The first says the deploy process completed; the second says the service is now deployed.

## Query Attributes

Each log should include these attributes so SQL queries do not need to parse JSON:

- `event.name`
- `cdevents.type`
- `cdevents.id`
- `deployment.id`
- `deployment.environment.name`
- `deployment.status`
- `service.name`
- `vcs.repository.name`
- `vcs.ref.head.revision`
- `url.full`
- `everr.github.deployment_status.id`
- `everr.github.deployment_status.environment_url`
- `everr.github.deployment.creator.login`

Use empty strings for optional missing values.

## Data Flow

1. GitHub sends `deployment` or `deployment_status` to `/webhook/github`.
2. The app verifies the webhook signature.
3. The app resolves the tenant from `installation.id`.
4. The raw webhook is queued and forwarded through the existing collector path.
5. The collector accepts deploy webhooks and maps them into OTel logs.
6. The collector exports those logs to ClickHouse.
7. Deploy history is queried from `app.logs`.

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
