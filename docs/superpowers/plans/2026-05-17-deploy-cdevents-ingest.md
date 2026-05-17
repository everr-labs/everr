# Deploy CDEvents Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest GitHub `deployment` and `deployment_status` webhooks into ClickHouse as OpenTelemetry log events with CDEvents-shaped bodies, then make `../everr-deploy` emit those GitHub deployment events and wait for ECS rollout completion.

**Architecture:** Everr keeps GitHub Deployments as the public user contract. The app verifies GitHub webhooks, resolves the tenant from the installation, and forwards deploy webhooks to the collector-only queue. The collector maps deploy webhooks directly to OTel logs without fetching GitHub Actions log archives, and `../everr-deploy` becomes the first adopter by creating GitHub Deployment records and status updates from its deploy workflow.

**Tech Stack:** TypeScript, TanStack Start file routes, pg-boss, Zod, Go collector receiver, OpenTelemetry Collector `plog`, ClickHouse `app.logs`, GitHub Deployments REST API, GitHub Actions, OpenTofu, AWS ECS `describe-services`.

---

## Context

Current Everr flow:

- `packages/app/src/routes/webhook/github.ts` exposes `/webhook/github`.
- `packages/app/src/server/github-events/webhook.ts` verifies GitHub signatures and currently accepts only `workflow_run` and `workflow_job` for queueing.
- `packages/app/src/server/github-events/runtime.ts` sends every queued webhook to both `gh-collector` and `gh-status`.
- `gh-status` writes workflow state to Postgres. Deploy events must not go there in v1.
- `gh-collector` resolves the tenant and forwards the raw webhook to `env.INGRESS_COLLECTOR_URL`, adding `x-everr-tenant-id`.
- `collector/receiver/githubactionsreceiver/receiver.go` accepts GitHub webhook payloads, but its workflow log path initializes an installation GitHub client and downloads workflow log archives.
- Deploy webhooks have no archive to fetch. They must be mapped directly from the webhook payload.
- `clickhouse/init/10-create-mvs.sql` copies `ResourceAttributes['everr.tenant.id']` into `app.logs.tenant_id`. Deploy log resources must include that attribute through the existing collector resource processor.

Current `../everr-deploy` flow:

- `../everr-deploy/.github/workflows/image-update.yml` opens image tag update PRs.
- `../everr-deploy/.github/workflows/deploy.yml` runs `tofu apply` on `main`, infra changes, and manual dispatch.
- ECS service names are created in modules:
  - app: `${var.name}-app`
  - docs: `${var.name}-docs`
  - collector: `${var.name}-everr-otel-collector`
- Root outputs currently expose URLs and ECR repos, but not ECS cluster/service names.

## Standards Locked For V1

- GitHub Deployments are the user-facing source. GitHub says deployments are deploy requests, and statuses can be `error`, `failure`, `pending`, `in_progress`, `queued`, or `success`: https://docs.github.com/en/enterprise-cloud@latest/rest/deployments/deployments
- CDEvents spec version is pinned to `0.5.0`: https://cdevents.dev/docs/
- CDEvents event types stay pinned to:
  - `dev.cdevents.pipelinerun.queued.0.3.0`
  - `dev.cdevents.pipelinerun.started.0.3.0`
  - `dev.cdevents.pipelinerun.finished.0.3.0`
  - `dev.cdevents.service.deployed.0.3.0`
- CDEvents versioning guidance says event versions live in event `type`, while spec version lives in `context.version`: https://cdevents.dev/docs/primer/#versioning-of-cdevents
- OTel logs are the right signal because OTel treats events as a special type of log: https://opentelemetry.io/docs/concepts/signals/logs/
- Use the OTel log record event-name field through `LogRecord.SetEventName(...)`; do not duplicate it in `LogAttributes['event.name']`.
- Use stable OTel attributes where they match:
  - `deployment.environment.name`: https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/
  - `service.name` and `service.version`: https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/
  - `cicd.pipeline.run.id`, `cicd.pipeline.run.state`, and `cicd.pipeline.result`: https://opentelemetry.io/docs/specs/semconv/registry/attributes/cicd/
- Do not use `url.full` for deployment URLs. `url.full` is generic URL semantic convention text, but this value is not the URL of a network call in this telemetry record: https://opentelemetry.io/docs/specs/semconv/registry/attributes/url/
- OTel 1.41 lists `deployment.id`, `deployment.name`, and `deployment.status` as Development. V1 keeps the deploy run identifier in `cicd.pipeline.run.id` and custom query fields under `everr.*` to avoid changing meaning later.
- AWS ECS `describe-services` exposes `deployments[].rolloutState`; AWS says it starts `IN_PROGRESS`, moves to `COMPLETED` at steady state, and moves to `FAILED` when circuit breaker marks failure: https://docs.aws.amazon.com/cli/latest/reference/ecs/describe-services.html

## Non-Goals

- No Postgres deploy table in v1.
- No custom ClickHouse deploy table in v1.
- No ClickHouse migration in this plan.
- No custom Everr deploy ingestion endpoint for users in v1. Users adopt by creating GitHub Deployments and Deployment Statuses.
- No capture for GitHub Actions jobs that only set `environment:` without creating a GitHub Deployment object, including `environment.deployment: false`.
- No deploy phase model in v1. Later, phase events can use CDEvents `taskrun.started` and `taskrun.finished` plus `everr.deploy.phase`.

## File Structure

Everr app changes:

- Modify `packages/app/src/server/github-events/webhook.ts`: accept `deployment` and `deployment_status`.
- Modify `packages/app/src/server/github-events/runtime.ts`: route workflow events to both queues and deploy events only to `gh-collector`.
- Modify `packages/app/src/server/github-events/payloads.ts`: parse minimal deploy webhook payloads and expose a shared installation-id helper.
- Modify `packages/app/src/server/github-events/webhook.test.ts`: assert deploy webhooks are accepted and not sent to `gh-status`.
- Add or modify runtime tests near `packages/app/src/server/github-events/runtime.test.ts` if the runtime queue split does not already have tests.

Collector changes:

- Add `collector/receiver/githubactionsreceiver/deploy_event_handling.go`: deploy webhook to OTel log mapping.
- Add `collector/receiver/githubactionsreceiver/deploy_event_handling_test.go`: mapper tests for every event mapping.
- Modify `collector/receiver/githubactionsreceiver/receiver.go`: dispatch deploy events before workflow trace, metric, and log archive processing.
- Modify `collector/receiver/githubactionsreceiver/attributes.go` or add `deploy_attributes.go`: deploy-specific resource/log attribute helpers.
- Modify `collector/semconv/cicd.go`: add Everr custom attribute constants for GitHub deployment fields.
- Add `collector/receiver/githubactionsreceiver/testdata/deployment/*.json`: minimal deployment and deployment_status fixtures.

ClickHouse/docs changes:

- No SQL file changes.
- Optional: add a small query example to the existing deploy spec if implementation finds a field name mismatch.

`../everr-deploy` changes:

- Modify `../everr-deploy/.github/workflows/deploy.yml`: create GitHub Deployment records, status updates, and ECS rollout wait.
- Add `../everr-deploy/scripts/changed-ecs-services.sh`: map changed Terraform/image files to ECS services.
- Add `../everr-deploy/scripts/create-github-deployment.sh`: create one GitHub Deployment per service and store IDs.
- Add `../everr-deploy/scripts/update-github-deployment-status.sh`: set deployment statuses.
- Add `../everr-deploy/scripts/wait-ecs-service-rollout.sh`: poll ECS until all rollout states are `COMPLETED`, fail on `FAILED`, and time out cleanly.
- Add tests under `../everr-deploy/scripts/tests/` for the shell scripts.
- Modify `../everr-deploy/infra/modules/*/outputs.tf` and `../everr-deploy/infra/outputs.tf`: expose ECS cluster and service names for the workflow.

## Data Contract

Every deploy OTel log record:

- `EventName`: one of the CDEvents event types or `everr.deploy.superseded`.
- `Body`: JSON CDEvents-shaped object.
- `ResourceAttributes`:
  - `everr.tenant.id`: set by the collector resource processor from `x-everr-tenant-id`.
  - `service.name`: `github-deployments`.
  - `deployment.environment.name`: GitHub deployment environment.
  - `vcs.provider.name`: `github`.
  - `vcs.repository.name`: GitHub repository full name.
  - `vcs.owner.name`: GitHub repository owner login when available.
- `LogAttributes`:
  - `cdevents.type`
  - `cdevents.id`
  - `cdevents.source`
  - `cicd.pipeline.run.id`
  - `cicd.pipeline.name`
  - `cicd.pipeline.run.state` for queued/started states
  - `cicd.pipeline.result` for finished states
  - `deployment.environment.name`
  - `vcs.ref.head.revision`
  - `vcs.ref.head.name`
  - `everr.deploy.id`
  - `everr.deploy.service.name`
  - `everr.deploy.url` when GitHub status provides `environment_url` or `target_url`
  - `everr.github.deployment.id`
  - `everr.github.deployment_status.id` for deployment_status events
  - `everr.github.deployment.creator.login`
  - `everr.github.workflow_run.id` and `everr.github.workflow_run.run_attempt` when present

Trace linkage:

- When a deploy webhook includes `workflow_run`, set the log record `TraceID` with `generateTraceID(repository.id, workflow_run.id, workflow_run.run_attempt)`.
- When `workflow_run` is absent, leave `TraceID` empty.

`deployment_status: success` emits two log records:

- `dev.cdevents.pipelinerun.finished.0.3.0`
- `dev.cdevents.service.deployed.0.3.0`

`deployment_status: inactive` emits one custom log record:

- `everr.deploy.superseded`

Do not map `inactive` to `service.removed`; GitHub can mark older deployments inactive when a newer successful deployment supersedes them.

## Tasks

### Task 1: App Accepts Deploy Webhooks

**Files:**

- Modify: `packages/app/src/server/github-events/webhook.ts`
- Modify: `packages/app/src/server/github-events/webhook.test.ts`

- [ ] **Step 1: Write failing webhook allowlist tests**

Add these tests to `packages/app/src/server/github-events/webhook.test.ts`:

```ts
it("enqueues deployment events", async () => {
  const secret = webhookSecret;
  vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
  const payload = JSON.stringify({
    action: "created",
    installation: { id: 123 },
    repository: { id: 654321, full_name: "everr-labs/everr-deploy" },
    deployment: {
      id: 987,
      sha: "abc123",
      ref: "main",
      task: "deploy:app",
      environment: "production",
      created_at: "2026-05-17T10:00:00Z",
      updated_at: "2026-05-17T10:00:00Z",
    },
  });

  const response = await handleGitHubWebhookRequest(
    new Request("http://localhost/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "deployment",
        "x-github-delivery": "delivery-deploy-1",
        "x-hub-signature-256": sign(payload, secret),
      },
      body: payload,
    }),
  );

  expect(response.status).toBe(202);
  expect(webhookMocks.enqueueWebhookEvent).toHaveBeenCalledOnce();
  expect(webhookMocks.enqueueWebhookEvent).toHaveBeenCalledWith(
    "delivery-deploy-1",
    {
      headers: expect.objectContaining({
        "x-github-event": ["deployment"],
      }),
      body: expect.any(String),
    },
    { statusQueue: false },
  );
});

it("enqueues deployment_status events", async () => {
  const secret = webhookSecret;
  vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
  const payload = JSON.stringify({
    action: "created",
    installation: { id: 123 },
    repository: { id: 654321, full_name: "everr-labs/everr-deploy" },
    deployment: {
      id: 987,
      sha: "abc123",
      ref: "main",
      task: "deploy:app",
      environment: "production",
    },
    deployment_status: {
      id: 988,
      state: "success",
      environment_url: "https://app.everr.dev",
      target_url: "https://github.com/everr-labs/everr-deploy/actions/runs/1",
      created_at: "2026-05-17T10:04:00Z",
      updated_at: "2026-05-17T10:04:00Z",
    },
  });

  const response = await handleGitHubWebhookRequest(
    new Request("http://localhost/webhook/github", {
      method: "POST",
      headers: {
        "x-github-event": "deployment_status",
        "x-github-delivery": "delivery-deploy-status-1",
        "x-hub-signature-256": sign(payload, secret),
      },
      body: payload,
    }),
  );

  expect(response.status).toBe(202);
  expect(webhookMocks.enqueueWebhookEvent).toHaveBeenCalledWith(
    "delivery-deploy-status-1",
    expect.any(Object),
    { statusQueue: false },
  );
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @everr/app test:ci src/server/github-events/webhook.test.ts
```

Expected: the new tests fail because deploy event types are currently ignored and `enqueueWebhookEvent` accepts only two arguments.

- [ ] **Step 3: Add explicit collector-event allowlist**

In `packages/app/src/server/github-events/webhook.ts`, add:

```ts
const collectorEventTypes = new Set([
  "workflow_run",
  "workflow_job",
  "deployment",
  "deployment_status",
]);

const workflowStatusEventTypes = new Set(["workflow_run", "workflow_job"]);
```

Replace the current ignored-event check with:

```ts
if (!collectorEventTypes.has(eventType)) {
  return new Response(null, { status: 202 });
}
```

Replace the queue call with:

```ts
await enqueueWebhookEvent(
  eventId,
  {
    headers: headersToRecord(request.headers),
    body: body.toString("base64"),
  },
  { statusQueue: workflowStatusEventTypes.has(eventType) },
);
```

- [ ] **Step 4: Run the webhook tests again**

Run:

```bash
pnpm --filter @everr/app test:ci src/server/github-events/webhook.test.ts
```

Expected: the new deployment tests still fail until Task 2 updates the queue function signature.

### Task 2: App Routes Deploy Events Only To Collector

**Files:**

- Modify: `packages/app/src/server/github-events/runtime.ts`
- Modify: `packages/app/src/server/github-events/payloads.ts`
- Add or modify: `packages/app/src/server/github-events/runtime.test.ts`

- [ ] **Step 1: Add runtime tests for queue selection**

Create `packages/app/src/server/github-events/runtime.test.ts` if it does not exist. Mock `PgBoss` so the test can inspect `.send(...)` calls without connecting to Postgres.

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sends } = vi.hoisted(() => ({ sends: [] as unknown[][] }));

vi.mock("pg-boss", () => ({
  PgBoss: class {
    on = vi.fn();
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    createQueue = vi.fn().mockResolvedValue(undefined);
    work = vi.fn();
    send = vi.fn(async (...args: unknown[]) => {
      sends.push(args);
    });
  },
}));

vi.mock("@/db/client", () => ({
  db: {},
  pool: { query: vi.fn() },
}));

import { enqueueWebhookEvent } from "./runtime";

describe("enqueueWebhookEvent", () => {
  beforeEach(() => {
    sends.length = 0;
  });

  it("sends workflow events to collector and status queues", async () => {
    await enqueueWebhookEvent(
      "delivery-workflow",
      { headers: {}, body: "e30=" },
      { statusQueue: true },
    );

    expect(sends.map((call) => call[0])).toEqual(["gh-collector", "gh-status"]);
  });

  it("sends deploy events only to the collector queue", async () => {
    await enqueueWebhookEvent(
      "delivery-deploy",
      { headers: {}, body: "e30=" },
      { statusQueue: false },
    );

    expect(sends.map((call) => call[0])).toEqual(["gh-collector"]);
  });
});
```

- [ ] **Step 2: Run the failing runtime test**

Run:

```bash
pnpm --filter @everr/app test:ci src/server/github-events/runtime.test.ts
```

Expected: TypeScript or runtime failure because `enqueueWebhookEvent` has no third argument.

- [ ] **Step 3: Add the queue options type**

In `packages/app/src/server/github-events/runtime.ts`, add:

```ts
type EnqueueWebhookEventOptions = {
  statusQueue: boolean;
};
```

Change the function signature:

```ts
export async function enqueueWebhookEvent(
  eventId: string,
  data: WebhookJobData,
  options: EnqueueWebhookEventOptions = { statusQueue: true },
): Promise<void> {
```

Replace the hard-coded queue list with:

```ts
const queues = options.statusQueue
  ? (["gh-collector", "gh-status"] as const)
  : (["gh-collector"] as const);

await Promise.all(
  queues.map((queue) =>
    b.send(queue, data, {
      id: eventId,
      retryLimit: GH_EVENTS_CONFIG.maxAttempts,
      retryBackoff: true,
    }),
  ),
);
```

- [ ] **Step 4: Extend queued payload parsing for deploy events**

In `packages/app/src/server/github-events/payloads.ts`, add schemas:

```ts
const deploymentSchema = z.object({
  action: z.string().optional(),
  installation: z.object({ id: z.number().int().positive().optional() }).optional(),
  repository: repositorySchema,
  deployment: z
    .object({
      id: z.number().int(),
      sha: z.string().nullish(),
      ref: z.string().nullish(),
      task: z.string().nullish(),
      environment: z.string().nullish(),
      created_at: z.string().nullish(),
      updated_at: z.string().nullish(),
      creator: z.object({ login: z.string().optional() }).nullish(),
    })
    .optional(),
  workflow_run: z
    .object({
      id: z.number().int(),
      run_attempt: z.number().int().optional(),
    })
    .optional(),
});

const deploymentStatusSchema = deploymentSchema.extend({
  deployment_status: z
    .object({
      id: z.number().int(),
      state: z.string(),
      environment_url: z.string().nullish(),
      target_url: z.string().nullish(),
      log_url: z.string().nullish(),
      description: z.string().nullish(),
      created_at: z.string().nullish(),
      updated_at: z.string().nullish(),
    })
    .optional(),
});
```

Extend the event union:

```ts
export type DeploymentPayload = z.infer<typeof deploymentSchema>;
export type DeploymentStatusPayload = z.infer<typeof deploymentStatusSchema>;
export type ParsedQueuedCollectorEvent =
  | ParsedQueuedWorkflowEvent
  | { eventType: "deployment"; payload: DeploymentPayload }
  | { eventType: "deployment_status"; payload: DeploymentStatusPayload };
```

Add:

```ts
export function parseQueuedCollectorEvent(
  eventType: string,
  body: Buffer,
): ParsedQueuedCollectorEvent {
  if (eventType === "deployment") {
    return {
      eventType,
      payload: parseJson(body, deploymentSchema, "deployment"),
    };
  }

  if (eventType === "deployment_status") {
    return {
      eventType,
      payload: parseJson(body, deploymentStatusSchema, "deployment_status"),
    };
  }

  return parseQueuedWorkflowEvent(eventType, body);
}
```

Change `installationIdFromQueuedEvent(...)` to accept `ParsedQueuedCollectorEvent` instead of only `ParsedQueuedWorkflowEvent`.

- [ ] **Step 5: Use collector parser only in collector worker**

In `packages/app/src/server/github-events/runtime.ts`, import `parseQueuedCollectorEvent` and use it only in `processCollectorJob`.

Keep `processStatusJob` on `parseQueuedWorkflowEvent`:

```ts
const parsed = parseQueuedCollectorEvent(eventType, body);
```

The status worker remains:

```ts
const parsed = parseQueuedWorkflowEvent(eventType, body);
```

- [ ] **Step 6: Run app tests**

Run:

```bash
pnpm --filter @everr/app test:ci src/server/github-events/webhook.test.ts src/server/github-events/runtime.test.ts
pnpm --filter @everr/app typecheck
```

Expected: targeted tests pass and typecheck completes.

- [ ] **Step 7: Commit app intake changes**

Run:

```bash
git add packages/app/src/server/github-events/webhook.ts packages/app/src/server/github-events/webhook.test.ts packages/app/src/server/github-events/runtime.ts packages/app/src/server/github-events/runtime.test.ts packages/app/src/server/github-events/payloads.ts
git commit -m "feat: accept GitHub deployment webhooks"
```

### Task 3: Collector Maps Deployment Events To OTel Logs

**Files:**

- Add: `collector/receiver/githubactionsreceiver/deploy_event_handling.go`
- Add: `collector/receiver/githubactionsreceiver/deploy_event_handling_test.go`
- Add: `collector/receiver/githubactionsreceiver/deploy_attributes.go`
- Modify: `collector/semconv/cicd.go`
- Add: `collector/receiver/githubactionsreceiver/testdata/deployment/deployment_created.json`
- Add: `collector/receiver/githubactionsreceiver/testdata/deployment/deployment_status_success.json`
- Add: `collector/receiver/githubactionsreceiver/testdata/deployment/deployment_status_inactive.json`

- [ ] **Step 1: Add semconv constants**

Append to `collector/semconv/cicd.go`:

```go
// Everr - CDEvents and deployment attributes with no stable OTel equivalent.
const (
	CDEventsType   = "cdevents.type"
	CDEventsID     = "cdevents.id"
	CDEventsSource = "cdevents.source"

	EverrDeployID          = "everr.deploy.id"
	EverrDeployServiceName = "everr.deploy.service.name"
	EverrDeployURL         = "everr.deploy.url"

	EverrGitHubDeploymentID           = "everr.github.deployment.id"
	EverrGitHubDeploymentStatusID     = "everr.github.deployment_status.id"
	EverrGitHubDeploymentCreatorLogin = "everr.github.deployment.creator.login"
)
```

- [ ] **Step 2: Add minimal fixture files**

Create `collector/receiver/githubactionsreceiver/testdata/deployment/deployment_created.json`:

```json
{
  "action": "created",
  "deployment": {
    "id": 987,
    "sha": "abc123",
    "ref": "main",
    "task": "deploy:app",
    "environment": "production",
    "created_at": "2026-05-17T10:00:00Z",
    "updated_at": "2026-05-17T10:00:00Z",
    "creator": { "login": "github-actions[bot]" }
  },
  "repository": {
    "id": 654321,
    "name": "everr-deploy",
    "full_name": "everr-labs/everr-deploy",
    "html_url": "https://github.com/everr-labs/everr-deploy",
    "owner": { "login": "everr-labs" }
  },
  "installation": { "id": 123 },
  "sender": { "login": "github-actions[bot]" }
}
```

Create `collector/receiver/githubactionsreceiver/testdata/deployment/deployment_status_success.json`:

```json
{
  "action": "created",
  "deployment": {
    "id": 987,
    "sha": "abc123",
    "ref": "main",
    "task": "deploy:app",
    "environment": "production",
    "created_at": "2026-05-17T10:00:00Z",
    "updated_at": "2026-05-17T10:00:00Z",
    "creator": { "login": "github-actions[bot]" }
  },
  "deployment_status": {
    "id": 988,
    "state": "success",
    "environment_url": "https://app.everr.dev",
    "target_url": "https://github.com/everr-labs/everr-deploy/actions/runs/1",
    "description": "app rollout completed",
    "created_at": "2026-05-17T10:04:00Z",
    "updated_at": "2026-05-17T10:04:00Z"
  },
  "repository": {
    "id": 654321,
    "name": "everr-deploy",
    "full_name": "everr-labs/everr-deploy",
    "html_url": "https://github.com/everr-labs/everr-deploy",
    "owner": { "login": "everr-labs" }
  },
  "installation": { "id": 123 },
  "sender": { "login": "github-actions[bot]" }
}
```

Create `collector/receiver/githubactionsreceiver/testdata/deployment/deployment_status_inactive.json`:

```json
{
  "action": "created",
  "deployment": {
    "id": 986,
    "sha": "def456",
    "ref": "main",
    "task": "deploy:app",
    "environment": "production",
    "created_at": "2026-05-17T09:00:00Z",
    "updated_at": "2026-05-17T09:00:00Z",
    "creator": { "login": "github-actions[bot]" }
  },
  "deployment_status": {
    "id": 989,
    "state": "inactive",
    "environment_url": "https://app.everr.dev",
    "target_url": "https://github.com/everr-labs/everr-deploy/actions/runs/1",
    "description": "superseded by a newer deployment",
    "created_at": "2026-05-17T10:05:00Z",
    "updated_at": "2026-05-17T10:05:00Z"
  },
  "repository": {
    "id": 654321,
    "name": "everr-deploy",
    "full_name": "everr-labs/everr-deploy",
    "html_url": "https://github.com/everr-labs/everr-deploy",
    "owner": { "login": "everr-labs" }
  },
  "installation": { "id": 123 },
  "sender": { "login": "github-actions[bot]" }
}
```

- [ ] **Step 3: Write failing mapper tests**

In `collector/receiver/githubactionsreceiver/deploy_event_handling_test.go`, add tests:

```go
func TestDeploymentEventToLogsMapsDeploymentCreated(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentEvent](t, "testdata/deployment/deployment_created.json", "deployment")

	logs, err := deploymentEventToLogs(event, zap.NewNop())

	require.NoError(t, err)
	require.NotNil(t, logs)
	require.Equal(t, 1, logs.LogRecordCount())

	record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	require.Equal(t, "dev.cdevents.pipelinerun.queued.0.3.0", record.EventName())
	require.Equal(t, "dev.cdevents.pipelinerun.queued.0.3.0", record.Attributes().AsRaw()[semconv.CDEventsType])
	require.Equal(t, int64(987), record.Attributes().AsRaw()[semconv.EverrGitHubDeploymentID])
	require.Equal(t, "987", record.Attributes().AsRaw()[string(conventions.CICDPipelineRunIDKey)])

	resourceAttrs := logs.ResourceLogs().At(0).Resource().Attributes().AsRaw()
	require.Equal(t, "github-deployments", resourceAttrs["service.name"])
	require.Equal(t, "production", resourceAttrs["deployment.environment.name"])
	require.Equal(t, "everr-labs/everr-deploy", resourceAttrs[string(conventions.VCSRepositoryNameKey)])
}

func TestDeploymentStatusSuccessEmitsPipelineFinishedAndServiceDeployed(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentStatusEvent](t, "testdata/deployment/deployment_status_success.json", "deployment_status")

	logs, err := deploymentEventToLogs(event, zap.NewNop())

	require.NoError(t, err)
	require.NotNil(t, logs)
	require.Equal(t, 2, logs.LogRecordCount())

	records := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords()
	require.Equal(t, "dev.cdevents.pipelinerun.finished.0.3.0", records.At(0).EventName())
	require.Equal(t, "success", records.At(0).Attributes().AsRaw()[string(conventions.CICDPipelineResultKey)])
	require.Equal(t, "dev.cdevents.service.deployed.0.3.0", records.At(1).EventName())
	require.Equal(t, "https://app.everr.dev", records.At(1).Attributes().AsRaw()[semconv.EverrDeployURL])
}

func TestDeploymentStatusInactiveEmitsSuperseded(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentStatusEvent](t, "testdata/deployment/deployment_status_inactive.json", "deployment_status")

	logs, err := deploymentEventToLogs(event, zap.NewNop())

	require.NoError(t, err)
	require.NotNil(t, logs)
	require.Equal(t, 1, logs.LogRecordCount())
	record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	require.Equal(t, "everr.deploy.superseded", record.EventName())
	require.NotContains(t, record.Body().Str(), "service.removed")
}
```

If no generic `parseGitHubTestEvent` helper exists, add it at the top of the test file:

```go
func parseGitHubTestEvent[T any](t *testing.T, path string, eventType string) T {
	t.Helper()
	payload, err := os.ReadFile(path)
	require.NoError(t, err)

	event, err := github.ParseWebHook(eventType, payload)
	require.NoError(t, err)

	typed, ok := event.(T)
	require.True(t, ok)
	return typed
}
```

- [ ] **Step 4: Run the failing mapper tests**

Run:

```bash
cd collector/receiver/githubactionsreceiver
go test ./... -run 'TestDeployment' -count=1
```

Expected: compile failure because `deploymentEventToLogs` does not exist.

- [ ] **Step 5: Implement deploy resource attributes**

Create `collector/receiver/githubactionsreceiver/deploy_attributes.go`:

```go
package githubactionsreceiver

import (
	"strings"

	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
)

const githubDeploymentsServiceName = "github-deployments"

func setDeploymentResourceAttributes(attrs pcommon.Map, repo *github.Repository, environment string) {
	attrs.PutStr("service.name", githubDeploymentsServiceName)
	if environment != "" {
		attrs.PutStr("deployment.environment.name", environment)
	}
	attrs.PutStr(string(conventions.VCSProviderNameKey), "github")
	if repo != nil {
		attrs.PutStr(string(conventions.VCSRepositoryNameKey), repo.GetFullName())
		attrs.PutStr(string(conventions.VCSOwnerNameKey), repo.GetOwner().GetLogin())
	}
}

func deploymentServiceName(task string) string {
	task = strings.TrimSpace(task)
	if task == "" {
		return "deploy"
	}
	if after, ok := strings.CutPrefix(task, "deploy:"); ok && strings.TrimSpace(after) != "" {
		return strings.TrimSpace(after)
	}
	return task
}
```

- [ ] **Step 6: Implement deploy event mapping**

Create `collector/receiver/githubactionsreceiver/deploy_event_handling.go` with these constants and top-level dispatcher:

```go
package githubactionsreceiver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/go-github/v67/github"
	"github.com/everr-labs/everr/collector/semconv"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
	"go.uber.org/zap"
)

const (
	cdeventsSpecVersion        = "0.5.0"
	cdeventsPipelineRunQueued  = "dev.cdevents.pipelinerun.queued.0.3.0"
	cdeventsPipelineRunStarted = "dev.cdevents.pipelinerun.started.0.3.0"
	cdeventsPipelineRunDone    = "dev.cdevents.pipelinerun.finished.0.3.0"
	cdeventsServiceDeployed    = "dev.cdevents.service.deployed.0.3.0"
	everrDeploySuperseded      = "everr.deploy.superseded"
)

func deploymentEventToLogs(event interface{}, logger *zap.Logger) (*plog.Logs, error) {
	switch e := event.(type) {
	case *github.DeploymentEvent:
		return deploymentCreatedToLogs(e, logger)
	case *github.DeploymentStatusEvent:
		return deploymentStatusToLogs(e, logger)
	default:
		return nil, nil
	}
}
```

Implement `deploymentCreatedToLogs`, `deploymentStatusToLogs`, and helpers so:

```go
func deploymentCreatedToLogs(e *github.DeploymentEvent, logger *zap.Logger) (*plog.Logs, error) {
	logs, records := newDeploymentLogs(e.GetRepo(), e.GetDeployment().GetEnvironment())
	record := records.AppendEmpty()
	fillDeploymentLogRecord(record, deploymentLogInput{
		EventType: cdeventsPipelineRunQueued,
		Repo: e.GetRepo(),
		Deployment: e.GetDeployment(),
		State: "pending",
		Result: "",
		URL: "",
		Time: firstNonZeroTime(e.GetDeployment().GetCreatedAt().Time, e.GetDeployment().GetUpdatedAt().Time),
	})
	return &logs, nil
}
```

```go
func deploymentStatusToLogs(e *github.DeploymentStatusEvent, logger *zap.Logger) (*plog.Logs, error) {
	status := e.GetDeploymentStatus()
	state := status.GetState()
	logs, records := newDeploymentLogs(e.GetRepo(), e.GetDeployment().GetEnvironment())

	switch state {
	case "in_progress", "queued", "pending":
		record := records.AppendEmpty()
		fillDeploymentLogRecord(record, deploymentLogInput{
			EventType: cdeventsPipelineRunStarted,
			Repo: e.GetRepo(),
			Deployment: e.GetDeployment(),
			Status: status,
			State: "executing",
			URL: firstString(status.GetEnvironmentURL(), status.GetTargetURL(), status.GetLogURL()),
			Time: firstNonZeroTime(status.GetCreatedAt().Time, status.GetUpdatedAt().Time),
		})
	case "success":
		finished := records.AppendEmpty()
		fillDeploymentLogRecord(finished, deploymentLogInput{
			EventType: cdeventsPipelineRunDone,
			Repo: e.GetRepo(),
			Deployment: e.GetDeployment(),
			Status: status,
			Result: "success",
			URL: firstString(status.GetEnvironmentURL(), status.GetTargetURL(), status.GetLogURL()),
			Time: firstNonZeroTime(status.GetCreatedAt().Time, status.GetUpdatedAt().Time),
		})
		deployed := records.AppendEmpty()
		fillDeploymentLogRecord(deployed, deploymentLogInput{
			EventType: cdeventsServiceDeployed,
			Repo: e.GetRepo(),
			Deployment: e.GetDeployment(),
			Status: status,
			Result: "success",
			URL: firstString(status.GetEnvironmentURL(), status.GetTargetURL(), status.GetLogURL()),
			Time: firstNonZeroTime(status.GetCreatedAt().Time, status.GetUpdatedAt().Time),
		})
	case "failure", "error":
		record := records.AppendEmpty()
		fillDeploymentLogRecord(record, deploymentLogInput{
			EventType: cdeventsPipelineRunDone,
			Repo: e.GetRepo(),
			Deployment: e.GetDeployment(),
			Status: status,
			Result: state,
			URL: firstString(status.GetEnvironmentURL(), status.GetTargetURL(), status.GetLogURL()),
			Time: firstNonZeroTime(status.GetCreatedAt().Time, status.GetUpdatedAt().Time),
		})
	case "inactive":
		record := records.AppendEmpty()
		fillDeploymentLogRecord(record, deploymentLogInput{
			EventType: everrDeploySuperseded,
			Repo: e.GetRepo(),
			Deployment: e.GetDeployment(),
			Status: status,
			Result: "inactive",
			URL: firstString(status.GetEnvironmentURL(), status.GetTargetURL(), status.GetLogURL()),
			Time: firstNonZeroTime(status.GetCreatedAt().Time, status.GetUpdatedAt().Time),
		})
	default:
		logger.Debug("Skipping unsupported deployment_status state", zap.String("state", state))
	}

	if logs.LogRecordCount() == 0 {
		return nil, nil
	}
	return &logs, nil
}
```

Use a CDEvents body shape:

```go
type cdeventsBody struct {
	Context cdeventsContext `json:"context"`
	Subject cdeventsSubject `json:"subject"`
}

type cdeventsContext struct {
	Version string `json:"version"`
	ID string `json:"id"`
	Source string `json:"source"`
	Type string `json:"type"`
	Timestamp string `json:"timestamp,omitempty"`
}

type cdeventsSubject struct {
	ID string `json:"id"`
	Type string `json:"type"`
	Source string `json:"source,omitempty"`
	Content map[string]any `json:"content,omitempty"`
}
```

Use this input type and helper set:

```go
type deploymentLogInput struct {
	EventType  string
	Repo      *github.Repository
	Deployment *github.Deployment
	Status    *github.DeploymentStatus
	State     string
	Result    string
	URL       string
	Time      time.Time
}

func newDeploymentLogs(repo *github.Repository, environment string) (plog.Logs, plog.LogRecordSlice) {
	logs := plog.NewLogs()
	resourceLogs := logs.ResourceLogs().AppendEmpty()
	setDeploymentResourceAttributes(resourceLogs.Resource().Attributes(), repo, environment)
	scopeLogs := resourceLogs.ScopeLogs().AppendEmpty()
	scopeLogs.Scope().SetName("github-deployments")
	return logs, scopeLogs.LogRecords()
}

func firstString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func firstNonZeroTime(values ...time.Time) time.Time {
	for _, value := range values {
		if !value.IsZero() {
			return value
		}
	}
	return time.Now().UTC()
}

func cdeventsSource(repo *github.Repository) string {
	if repo == nil || repo.GetFullName() == "" {
		return "/github/deployments"
	}
	return fmt.Sprintf("/github/%s/deployments", repo.GetFullName())
}

func cdeventsID(input deploymentLogInput) string {
	statusID := int64(0)
	if input.Status != nil {
		statusID = input.Status.GetID()
	}
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%d", input.EventType, input.Deployment.GetID(), statusID)))
	return hex.EncodeToString(hash[:])
}
```

Inside `fillDeploymentLogRecord(...)`, set:

```go
record.SetEventName(input.EventType)
record.SetTimestamp(pcommon.NewTimestampFromTime(input.Time))
attrs := record.Attributes()
attrs.PutStr(semconv.CDEventsType, input.EventType)
attrs.PutStr(semconv.CDEventsID, cdeventsID(input))
attrs.PutStr(semconv.CDEventsSource, cdeventsSource(input.Repo))
attrs.PutStr(string(conventions.CICDPipelineRunIDKey), fmt.Sprintf("%d", input.Deployment.GetID()))
attrs.PutStr(string(conventions.CICDPipelineNameKey), firstString(input.Deployment.GetTask(), "deploy"))
attrs.PutStr("deployment.environment.name", input.Deployment.GetEnvironment())
attrs.PutStr(string(conventions.VCSRefHeadRevisionKey), input.Deployment.GetSHA())
attrs.PutStr(string(conventions.VCSRefHeadNameKey), input.Deployment.GetRef())
attrs.PutStr(semconv.EverrDeployID, fmt.Sprintf("github-deployment-%d", input.Deployment.GetID()))
attrs.PutStr(semconv.EverrDeployServiceName, deploymentServiceName(input.Deployment.GetTask()))
attrs.PutInt(semconv.EverrGitHubDeploymentID, input.Deployment.GetID())
attrs.PutStr(semconv.EverrGitHubDeploymentCreatorLogin, input.Deployment.GetCreator().GetLogin())
```

Set `cicd.pipeline.run.state` only for `pending` and `executing`. Set `cicd.pipeline.result` only for `success`, `failure`, `error`, and `inactive`.

Marshal the CDEvents body and store it in `record.Body().SetStr(...)`.

- [ ] **Step 7: Add trace linkage test**

Create `collector/receiver/githubactionsreceiver/testdata/deployment/deployment_status_success_with_workflow_run.json`:

```json
{
  "action": "created",
  "deployment": {
    "id": 987,
    "sha": "abc123",
    "ref": "main",
    "task": "deploy:app",
    "environment": "production",
    "created_at": "2026-05-17T10:00:00Z",
    "updated_at": "2026-05-17T10:00:00Z",
    "creator": { "login": "github-actions[bot]" }
  },
  "deployment_status": {
    "id": 988,
    "state": "success",
    "environment_url": "https://app.everr.dev",
    "target_url": "https://github.com/everr-labs/everr-deploy/actions/runs/1",
    "description": "app rollout completed",
    "created_at": "2026-05-17T10:04:00Z",
    "updated_at": "2026-05-17T10:04:00Z"
  },
  "workflow_run": {
    "id": 456,
    "run_attempt": 2
  },
  "repository": {
    "id": 654321,
    "name": "everr-deploy",
    "full_name": "everr-labs/everr-deploy",
    "html_url": "https://github.com/everr-labs/everr-deploy",
    "owner": { "login": "everr-labs" }
  },
  "installation": { "id": 123 },
  "sender": { "login": "github-actions[bot]" }
}
```

Add a test:

```go
func TestDeploymentStatusUsesWorkflowTraceIDWhenPresent(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentStatusEvent](t, "testdata/deployment/deployment_status_success_with_workflow_run.json", "deployment_status")

	logs, err := deploymentEventToLogs(event, zap.NewNop())

	require.NoError(t, err)
	expected, err := generateTraceID(654321, 456, 2)
	require.NoError(t, err)
	record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	require.Equal(t, expected, record.TraceID())
}
```

Implement a helper that checks `event.GetWorkflowRun()` on `github.DeploymentEvent` and `github.DeploymentStatusEvent`. If present and repo id is positive, set `TraceID` on every emitted record.

- [ ] **Step 8: Run mapper tests**

Run:

```bash
cd collector/receiver/githubactionsreceiver
go test ./... -run 'TestDeployment' -count=1
```

Expected: deploy mapper tests pass.

### Task 4: Collector Dispatches Deploy Events Before Workflow Paths

**Files:**

- Modify: `collector/receiver/githubactionsreceiver/receiver.go`
- Modify: `collector/receiver/githubactionsreceiver/receiver_test.go`

- [ ] **Step 1: Add receiver test proving deploy path does not need GitHub API auth**

Add a receiver test using a valid GitHub webhook signature and a `deployment_status` payload, but config with no GitHub API app id/private key. The logs consumer should receive logs and the response should be `202`.

```go
func TestReceiverDeploymentStatusDoesNotRequireGitHubAPIClient(t *testing.T) {
	cfg := createDefaultConfig().(*Config)
	cfg.Path = "/webhook/github"
	cfg.Secret = "secret"
	cfg.GitHubAPIConfig.Auth.AppID = 0
	cfg.GitHubAPIConfig.Auth.PrivateKey = ""

	consumer := newCapturingLogsConsumer()
	rcv, err := newReceiver(receivertest.NewNopSettings(metadata.Type), cfg)
	require.NoError(t, err)
	rcv.logsConsumer = consumer

	payload, err := os.ReadFile("testdata/deployment/deployment_status_success.json")
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/webhook/github", bytes.NewReader(payload))
	signGitHubRequest(req, "secret", payload)
	req.Header.Set("x-github-event", "deployment_status")
	req.Header.Set("x-everr-tenant-id", "42")
	rec := httptest.NewRecorder()

	rcv.ServeHTTP(rec, req)

	require.Equal(t, http.StatusAccepted, rec.Code)
	require.Len(t, consumer.logs, 1)
	require.Equal(t, 2, consumer.logs[0].LogRecordCount())
}
```

Use existing receiver test helpers where possible. If helper names differ, keep the same assertions and use the existing test style in `receiver_test.go`.

- [ ] **Step 2: Run the failing receiver test**

Run:

```bash
cd collector/receiver/githubactionsreceiver
go test ./... -run 'TestReceiverDeploymentStatusDoesNotRequireGitHubAPIClient' -count=1
```

Expected: failure because current receiver rejects unsupported event types or initializes GitHub API auth before logs.

- [ ] **Step 3: Add deploy event detection**

In `collector/receiver/githubactionsreceiver/receiver.go`, add:

```go
func isDeploymentWebhookEvent(event interface{}) bool {
	switch event.(type) {
	case *github.DeploymentEvent, *github.DeploymentStatusEvent:
		return true
	default:
		return false
	}
}
```

Extend the initial event switch:

```go
case *github.DeploymentEvent, *github.DeploymentStatusEvent:
	// Deploy events are mapped directly to logs below.
```

- [ ] **Step 4: Dispatch deploy logs before installation client setup**

After request metadata is copied into `client.Metadata`, add this block before `installationIDFromWebhookEvent(...)`:

```go
if isDeploymentWebhookEvent(event) {
	if gar.logsConsumer == nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	ld, err := deploymentEventToLogs(event, gar.logger.Named("deploymentEventToLogs"))
	if err != nil {
		gar.logger.Error("Failed to process deployment event", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	if ld != nil {
		if err := gar.logsConsumer.ConsumeLogs(ctx, *ld); err != nil {
			gar.logger.Error("Failed to consume deployment logs", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusAccepted)
	return
}
```

Leave the workflow-run and workflow-job path unchanged.

- [ ] **Step 5: Keep installation helper workflow-only**

Do not add deployment cases to `installationIDFromWebhookEvent(...)`. The deploy path returns before that helper and does not need a GitHub API client.

- [ ] **Step 6: Run collector tests**

Run:

```bash
cd collector/receiver/githubactionsreceiver
go test ./... -count=1
```

Expected: all receiver tests pass.

- [ ] **Step 7: Commit collector changes**

Run:

```bash
git add collector/receiver/githubactionsreceiver collector/semconv/cicd.go
git commit -m "feat: map GitHub deployment events to logs"
```

### Task 5: Query Contract Stays On Existing ClickHouse Logs

**Files:**

- No required SQL changes.
- Optional modify: `docs/superpowers/specs/2026-05-17-github-deploy-cdevents-ingest-summary.md`

- [ ] **Step 1: Verify no ClickHouse schema change is needed**

Inspect:

```bash
rg -n "EventName|ResourceAttributes|app.logs_mv|ORDER BY" clickhouse/init/03-create-otel-tables.sql clickhouse/init/10-create-mvs.sql
```

Expected:

- `otel.otel_logs` already has `EventName String`.
- `app.logs_mv` copies `ResourceAttributes['everr.tenant.id']` to `tenant_id`.
- `app.logs` orders by `(tenant_id, ServiceName, TimestampTime, Timestamp)`.

- [ ] **Step 2: Add or verify query example**

If the existing summary doc does not already show this, add a short query example:

```sql
SELECT
  TimestampTime,
  EventName,
  LogAttributes['everr.deploy.service.name'] AS deployed_service,
  LogAttributes['deployment.environment.name'] AS environment,
  LogAttributes['cicd.pipeline.result'] AS result,
  LogAttributes['everr.deploy.url'] AS deploy_url
FROM app.logs
WHERE ServiceName = 'github-deployments'
  AND TimestampTime >= now() - INTERVAL 7 DAY
ORDER BY TimestampTime DESC
LIMIT 100;
```

Do not add `PREWHERE`.

Do not add `tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))`; the row-level policy handles tenant filtering.

- [ ] **Step 3: Commit query doc change if any**

If the doc changed:

```bash
git add docs/superpowers/specs/2026-05-17-github-deploy-cdevents-ingest-summary.md
git commit -m "docs: clarify deploy event query contract"
```

### Task 6: everr-deploy Exposes ECS Service Names

**Files in `../everr-deploy`:**

- Modify: `infra/modules/app_service/outputs.tf`
- Modify: `infra/modules/docs_service/outputs.tf`
- Modify: `infra/modules/everr_otel_collector/outputs.tf`
- Modify: `infra/outputs.tf`

- [ ] **Step 1: Add module service name outputs**

Append to `../everr-deploy/infra/modules/app_service/outputs.tf`:

```hcl
output "ecs_service_name" {
  value = aws_ecs_service.this.name
}
```

Append to `../everr-deploy/infra/modules/docs_service/outputs.tf`:

```hcl
output "ecs_service_name" {
  value = aws_ecs_service.this.name
}
```

Append to `../everr-deploy/infra/modules/everr_otel_collector/outputs.tf`:

```hcl
output "ecs_service_name" {
  value = aws_ecs_service.this.name
}
```

- [ ] **Step 2: Add root outputs**

Append to `../everr-deploy/infra/outputs.tf`:

```hcl
output "ecs_cluster_name" {
  description = "ECS cluster name used by app, docs, and collector services."
  value       = aws_ecs_cluster.main.name
}

output "app_ecs_service_name" {
  description = "ECS service name for the Everr app service."
  value       = module.app_service.ecs_service_name
}

output "docs_ecs_service_name" {
  description = "ECS service name for the docs service."
  value       = module.docs_service.ecs_service_name
}

output "collector_ecs_service_name" {
  description = "ECS service name for the Everr OTel collector service."
  value       = module.everr_otel_collector.ecs_service_name
}
```

- [ ] **Step 3: Validate OpenTofu formatting**

Run:

```bash
cd ../everr-deploy/infra
tofu fmt -check -recursive
tofu validate -no-color
```

Expected: both commands pass after `tofu init` has already been run in that workspace. If `tofu validate` asks for init, run `tofu init -input=false` and rerun validate.

- [ ] **Step 4: Commit outputs**

Run from `../everr-deploy`:

```bash
git add infra/modules/app_service/outputs.tf infra/modules/docs_service/outputs.tf infra/modules/everr_otel_collector/outputs.tf infra/outputs.tf
git commit -m "deploy: expose ecs service outputs"
```

### Task 7: everr-deploy Adds ECS Rollout Polling Script

**Files in `../everr-deploy`:**

- Add: `scripts/wait-ecs-service-rollout.sh`
- Add: `scripts/tests/wait-ecs-service-rollout.test.sh`

- [ ] **Step 1: Create rollout wait script**

Create `../everr-deploy/scripts/wait-ecs-service-rollout.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cluster="${1:?usage: wait-ecs-service-rollout.sh <cluster> <service> [timeout_seconds] [interval_seconds]}"
service="${2:?usage: wait-ecs-service-rollout.sh <cluster> <service> [timeout_seconds] [interval_seconds]}"
timeout_seconds="${3:-1200}"
interval_seconds="${4:-15}"
deadline=$((SECONDS + timeout_seconds))

while true; do
  states_json="$(
    aws ecs describe-services \
      --cluster "$cluster" \
      --services "$service" \
      --query 'services[0].deployments[].rolloutState' \
      --output json
  )"

  if jq -e 'length > 0 and any(.[]; . == "FAILED")' >/dev/null <<<"$states_json"; then
    echo "ECS service $service has a failed deployment: $states_json" >&2
    exit 1
  fi

  if jq -e 'length > 0 and all(.[]; . == "COMPLETED")' >/dev/null <<<"$states_json"; then
    echo "ECS service $service rollout completed"
    exit 0
  fi

  if (( SECONDS >= deadline )); then
    echo "Timed out waiting for ECS service $service rollout states to become COMPLETED: $states_json" >&2
    exit 124
  fi

  echo "Waiting for ECS service $service rollout states: $states_json"
  sleep "$interval_seconds"
done
```

- [ ] **Step 2: Add shell tests with fake AWS CLI**

Create `../everr-deploy/scripts/tests/wait-ecs-service-rollout.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cat >"$tmpdir/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
state_file="${FAKE_AWS_STATE_FILE:?missing FAKE_AWS_STATE_FILE}"
call_file="${FAKE_AWS_CALL_FILE:?missing FAKE_AWS_CALL_FILE}"
call="$(cat "$call_file")"
call=$((call + 1))
echo "$call" >"$call_file"
sed -n "${call}p" "$state_file"
AWS
chmod +x "$tmpdir/aws"

run_case() {
  local name="$1"
  local states="$2"
  local expected="$3"
  local call_file="$tmpdir/$name.calls"
  local state_file="$tmpdir/$name.states"
  printf '0' >"$call_file"
  printf '%s\n' "$states" >"$state_file"
  export FAKE_AWS_CALL_FILE="$call_file"
  export FAKE_AWS_STATE_FILE="$state_file"
  PATH="$tmpdir:$PATH" "$repo_root/scripts/wait-ecs-service-rollout.sh" cluster service 2 0
  actual="$?"
  if [[ "$actual" != "$expected" ]]; then
    echo "$name expected exit $expected, got $actual" >&2
    exit 1
  fi
}

run_case completed '["COMPLETED"]' 0

set +e
export FAKE_AWS_CALL_FILE="$tmpdir/failed.calls"
export FAKE_AWS_STATE_FILE="$tmpdir/failed.states"
printf '0' >"$FAKE_AWS_CALL_FILE"
printf '%s\n' '["IN_PROGRESS","FAILED"]' >"$FAKE_AWS_STATE_FILE"
PATH="$tmpdir:$PATH" "$repo_root/scripts/wait-ecs-service-rollout.sh" cluster service 2 0
status="$?"
set -e
if [[ "$status" != "1" ]]; then
  echo "failed case expected exit 1, got $status" >&2
  exit 1
fi
```

- [ ] **Step 3: Run the script tests**

Run from `../everr-deploy`:

```bash
chmod +x scripts/wait-ecs-service-rollout.sh scripts/tests/wait-ecs-service-rollout.test.sh
scripts/tests/wait-ecs-service-rollout.test.sh
```

Expected: test exits `0`.

- [ ] **Step 4: Commit rollout script**

Run from `../everr-deploy`:

```bash
git add scripts/wait-ecs-service-rollout.sh scripts/tests/wait-ecs-service-rollout.test.sh
git commit -m "deploy: wait for ecs rollouts"
```

### Task 8: everr-deploy Emits GitHub Deployment Statuses

**Files in `../everr-deploy`:**

- Add: `scripts/changed-ecs-services.sh`
- Add: `scripts/create-github-deployment.sh`
- Add: `scripts/update-github-deployment-status.sh`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add changed-service detection script**

Create `../everr-deploy/scripts/changed-ecs-services.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

base="${1:-}"
head="${2:-HEAD}"

if [[ -z "$base" || "$base" == "0000000000000000000000000000000000000000" ]]; then
  echo "app docs collector"
  exit 0
fi

changed="$(git diff --name-only "$base" "$head")"
services=()

if grep -q '^infra/images\.auto\.tfvars$' <<<"$changed"; then
  diff_text="$(git diff "$base" "$head" -- infra/images.auto.tfvars)"
  grep -q 'app_image_tag' <<<"$diff_text" && services+=("app")
  grep -q 'docs_image_tag' <<<"$diff_text" && services+=("docs")
  grep -q 'collector_image_tag' <<<"$diff_text" && services+=("collector")
fi

if grep -q '^infra/' <<<"$changed"; then
  if [[ "${#services[@]}" -eq 0 ]]; then
    services=("app" "docs" "collector")
  fi
fi

if [[ "${#services[@]}" -eq 0 ]]; then
  echo "app docs collector"
else
  printf '%s\n' "${services[@]}" | awk '!seen[$0]++' | paste -sd' ' -
fi
```

- [ ] **Step 2: Add deployment creation script**

Create `../everr-deploy/scripts/create-github-deployment.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

service="${1:?usage: create-github-deployment.sh <service> <environment> <deployment-id-output-file>}"
environment="${2:?usage: create-github-deployment.sh <service> <environment> <deployment-id-output-file>}"
output_file="${3:?usage: create-github-deployment.sh <service> <environment> <deployment-id-output-file>}"

payload="$(
  jq -n \
    --arg ref "$GITHUB_SHA" \
    --arg environment "$environment" \
    --arg task "deploy:$service" \
    --arg service "$service" \
    --arg workflow "$GITHUB_WORKFLOW" \
    --arg run_id "$GITHUB_RUN_ID" \
    --arg run_attempt "$GITHUB_RUN_ATTEMPT" \
    '{
      ref: $ref,
      environment: $environment,
      task: $task,
      auto_merge: false,
      required_contexts: [],
      payload: {
        service: $service,
        workflow: $workflow,
        workflow_run_id: $run_id,
        workflow_run_attempt: $run_attempt
      }
    }'
)"

deployment_id="$(
  gh api \
    --method POST \
    "repos/${GITHUB_REPOSITORY}/deployments" \
    --input - \
    --jq '.id' <<<"$payload"
)"

mkdir -p "$(dirname "$output_file")"
printf '%s' "$deployment_id" >"$output_file"
echo "Created GitHub deployment $deployment_id for $service"
```

- [ ] **Step 3: Add deployment status update script**

Create `../everr-deploy/scripts/update-github-deployment-status.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

deployment_id="${1:?usage: update-github-deployment-status.sh <deployment-id> <state> <description> [environment-url]}"
state="${2:?usage: update-github-deployment-status.sh <deployment-id> <state> <description> [environment-url]}"
description="${3:?usage: update-github-deployment-status.sh <deployment-id> <state> <description> [environment-url]}"
environment_url="${4:-}"

payload="$(
  jq -n \
    --arg state "$state" \
    --arg description "$description" \
    --arg log_url "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" \
    --arg environment_url "$environment_url" \
    '{
      state: $state,
      description: $description,
      log_url: $log_url,
      auto_inactive: true
    } + if $environment_url == "" then {} else {environment_url: $environment_url} end'
)"

gh api \
  --method POST \
  "repos/${GITHUB_REPOSITORY}/deployments/${deployment_id}/statuses" \
  --input - >/dev/null <<<"$payload"

echo "Set GitHub deployment $deployment_id to $state"
```

- [ ] **Step 4: Update deploy workflow permissions**

In `../everr-deploy/.github/workflows/deploy.yml`, replace:

```yaml
permissions:
  contents: read
```

with:

```yaml
permissions:
  contents: read
  deployments: write
```

- [ ] **Step 5: Add workflow environment variables**

Add under workflow `env:`:

```yaml
  DEPLOY_ENVIRONMENT: production
```

- [ ] **Step 6: Add deployment creation before apply**

In the `apply-infra` job, after `Init` and before `Apply`, add:

```yaml
      - name: Detect changed services
        id: services
        working-directory: .
        run: |
          SERVICES="$(scripts/changed-ecs-services.sh "${{ github.event.before }}" "${{ github.sha }}")"
          echo "services=${SERVICES}" >> "$GITHUB_OUTPUT"
          echo "Deploying services: ${SERVICES}"

      - name: Create GitHub deployments
        working-directory: .
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          mkdir -p .deployments
          for service in ${{ steps.services.outputs.services }}; do
            scripts/create-github-deployment.sh "$service" "$DEPLOY_ENVIRONMENT" ".deployments/${service}.id"
            deployment_id="$(cat ".deployments/${service}.id")"
            scripts/update-github-deployment-status.sh "$deployment_id" in_progress "${service} deploy started"
          done
```

- [ ] **Step 7: Add failure trap around apply and rollout wait**

Replace the current `Apply` step with:

```yaml
      - name: Apply and wait for ECS rollouts
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail

          mark_failed() {
            status="$?"
            for file in ../.deployments/*.id; do
              [ -f "$file" ] || continue
              service="$(basename "$file" .id)"
              deployment_id="$(cat "$file")"
              ../scripts/update-github-deployment-status.sh "$deployment_id" failure "${service} deploy failed"
            done
            exit "$status"
          }
          trap mark_failed ERR

          tofu apply -auto-approve -input=false

          cluster="$(tofu output -raw ecs_cluster_name)"
          app_service="$(tofu output -raw app_ecs_service_name)"
          docs_service="$(tofu output -raw docs_ecs_service_name)"
          collector_service="$(tofu output -raw collector_ecs_service_name)"
          app_url="$(tofu output -raw app_url)"
          docs_url="$(tofu output -raw docs_url)"

          for service in ${{ steps.services.outputs.services }}; do
            case "$service" in
              app)
                ecs_service="$app_service"
                environment_url="$app_url"
                ;;
              docs)
                ecs_service="$docs_service"
                environment_url="$docs_url"
                ;;
              collector)
                ecs_service="$collector_service"
                environment_url=""
                ;;
              *)
                echo "Unknown service: $service" >&2
                exit 1
                ;;
            esac

            ../scripts/wait-ecs-service-rollout.sh "$cluster" "$ecs_service" 1200 15
            deployment_id="$(cat "../.deployments/${service}.id")"
            ../scripts/update-github-deployment-status.sh "$deployment_id" success "${service} rollout completed" "$environment_url"
          done

          trap - ERR
```

Because the job default working directory is `./infra`, script paths in this step use `../scripts/...` and deployment id files live in `../.deployments`.

- [ ] **Step 8: Validate workflow YAML and shell scripts**

Run from `../everr-deploy`:

```bash
chmod +x scripts/changed-ecs-services.sh scripts/create-github-deployment.sh scripts/update-github-deployment-status.sh scripts/wait-ecs-service-rollout.sh
bash -n scripts/changed-ecs-services.sh scripts/create-github-deployment.sh scripts/update-github-deployment-status.sh scripts/wait-ecs-service-rollout.sh
python - <<'PY'
import pathlib, yaml
for path in pathlib.Path(".github/workflows").glob("*.yml"):
    yaml.safe_load(path.read_text())
print("workflow yaml parsed")
PY
```

Expected: shell syntax passes and workflow YAML parses.

- [ ] **Step 9: Commit everr-deploy workflow changes**

Run from `../everr-deploy`:

```bash
git add .github/workflows/deploy.yml scripts/changed-ecs-services.sh scripts/create-github-deployment.sh scripts/update-github-deployment-status.sh
git commit -m "deploy: emit github deployment statuses"
```

### Task 9: End-To-End Verification

**Files:**

- No required file changes.

- [ ] **Step 1: Run Everr app tests**

Run from `/Users/guidodorsi/workspace/everr`:

```bash
pnpm --filter @everr/app test:ci src/server/github-events/webhook.test.ts src/server/github-events/runtime.test.ts
pnpm --filter @everr/app typecheck
```

Expected: tests pass and typecheck completes.

- [ ] **Step 2: Run collector tests**

Run:

```bash
cd /Users/guidodorsi/workspace/everr/collector/receiver/githubactionsreceiver
go test ./... -count=1
```

Expected: tests pass.

- [ ] **Step 3: Run everr-deploy script tests**

Run:

```bash
cd /Users/guidodorsi/workspace/everr-deploy
scripts/tests/wait-ecs-service-rollout.test.sh
bash -n scripts/*.sh
```

Expected: tests and shell syntax checks pass.

- [ ] **Step 4: Confirm GitHub App configuration**

In the GitHub App settings used by Everr, confirm:

- Webhook events include `deployment`.
- Webhook events include `deployment_status`.
- Repository permission includes Deployments read access.
- The app is installed on `everr-labs/everr-deploy`.

Expected: `../everr-deploy` deployment events can reach Everr's `/webhook/github` route.

- [ ] **Step 5: Smoke test signed deploy webhook locally**

Run the app test helper or a local script that signs `collector/receiver/githubactionsreceiver/testdata/deployment/deployment_status_success.json` with `GITHUB_APP_WEBHOOK_SECRET` and posts it to:

```bash
curl -i \
  -X POST \
  -H "x-github-event: deployment_status" \
  -H "x-github-delivery: local-deploy-status-1" \
  -H "x-hub-signature-256: sha256=<computed-signature>" \
  --data-binary @collector/receiver/githubactionsreceiver/testdata/deployment/deployment_status_success.json \
  http://localhost:5173/webhook/github
```

Expected: response is `202`.

- [ ] **Step 6: Query ClickHouse after a real everr-deploy run**

Run through the app's existing ClickHouse query path:

```sql
SELECT
  TimestampTime,
  EventName,
  LogAttributes['everr.deploy.service.name'] AS deployed_service,
  LogAttributes['deployment.environment.name'] AS environment,
  LogAttributes['cicd.pipeline.result'] AS result
FROM app.logs
WHERE ServiceName = 'github-deployments'
  AND TimestampTime >= now() - INTERVAL 1 DAY
ORDER BY TimestampTime DESC
LIMIT 20;
```

Expected:

- At least one `dev.cdevents.pipelinerun.started.0.3.0` row per deployed service.
- A `dev.cdevents.pipelinerun.finished.0.3.0` row per deployed service.
- A `dev.cdevents.service.deployed.0.3.0` row per service that completed successfully.
- `tenant_id` is populated by `app.logs_mv`.

- [ ] **Step 7: Final commit if verification adjusts docs or tests**

Run:

```bash
git status --short
```

If verification required small follow-up edits:

```bash
git add <changed-files>
git commit -m "test: verify deployment event ingestion"
```

## Rollout Notes

- `../everr-deploy` will create one GitHub Deployment per service. This makes deploy frequency per service queryable without guessing from a single umbrella infra deployment.
- `tofu apply` still controls the actual infrastructure change. GitHub Deployment status is observability metadata around the deploy, not the deploy mechanism.
- ECS polling waits for every reported deployment rollout state to be `COMPLETED`. A single `FAILED` state marks the GitHub Deployment as failed.
- `deployment_status: inactive` rows are expected when GitHub auto-inactivates older deployments. Everr stores them as `everr.deploy.superseded`.
- No user-facing Everr-specific deploy action is needed for v1. A user can adopt by creating GitHub Deployments and setting Deployment Statuses from any CI/CD system.
