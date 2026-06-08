# Graphile Worker Migration Design

Date: 2026-06-08

## Goal

Replace the app's `pg-boss` usage with Graphile Worker for GitHub event background processing.

The migration should use Graphile Worker in a pragmatic, idiomatic way. It does not need exact feature parity with `pg-boss`; it should preserve the product behavior that matters: accepted GitHub webhook and backfill events are processed asynchronously by the collector and status writer, retryable failures retry, and terminal event errors do not retry.

## Current Context

`pg-boss` is only used by `packages/app/src/server/github-events/runtime.ts`.

That runtime:

- Starts lazily from `enqueueWebhookEvent`.
- Creates two queues: collector and status.
- Enqueues the same webhook payload to both queues.
- Processes collector jobs through `replayWebhookToCollector`.
- Processes status jobs through `handleStatusEvent`.
- Treats `TerminalEventError` as a logged terminal outcome.
- Uses `GH_EVENTS_CONFIG.maxAttempts` and `GH_EVENTS_CONFIG.workerCount`.

Callers are the GitHub webhook handler and historical backfill flow. The public runtime API can stay as `enqueueWebhookEvent(eventId, data)` so those callers do not need structural changes.

## Recommended Approach

Use Graphile Worker inside the existing app process.

This keeps the migration small because the current worker already runs in-process and starts lazily. A separate worker process may become useful later, but it adds deployment and lifecycle work that is not required for this migration.

## Architecture

`packages/app/src/server/github-events/runtime.ts` will own the Graphile Worker runner singleton.

The runner will use the existing `pg.Pool` from `@/db/client` and an in-memory `taskList`, not a filesystem task directory. That keeps task code colocated with the existing runtime and avoids adding a build/load path for task files.

Task identifiers:

- `github-events/collector`
- `github-events/status`

Each task receives the existing `WebhookJobData` payload and delegates to the same processing logic already used by `pg-boss` workers.

## Enqueueing

`enqueueWebhookEvent(eventId, data)` will:

1. Ensure the Graphile Worker runner is started.
2. Add one collector task.
3. Add one status task.

Each job will use:

- `maxAttempts: GH_EVENTS_CONFIG.maxAttempts`
- a stable `jobKey` that includes the task identifier and `eventId`
- no `queueName`
- default `jobKeyMode` behavior

The `jobKey` is for useful de-duping and administrative visibility, not exact `pg-boss` compatibility. Graphile Worker's default `replace` mode is acceptable for pending duplicate webhook deliveries because the same delivery ID carries the same payload. Do not use `unsafe_dedupe`; it can suppress new work when an existing matching job is already locked or permanently failed.

## Error Handling

Graphile Worker retries a job when its task throws. Keep that behavior for ordinary collector/status failures.

For `TerminalEventError`, record the exception on the span, log the terminal error, and return without throwing. That makes the job complete successfully from Graphile Worker's perspective, matching the intended no-retry behavior.

Runner-level Graphile Worker events should log meaningful runtime failures using `serverLogger`. Rename pg-boss-specific log names and span attributes to Graphile Worker terms.

## Data And Migrations

Graphile Worker will create and maintain its own worker schema through its normal startup migrations.

Do not generate Drizzle migrations for this change. The application schema is not changing.

Existing `pg-boss` tables will not be cleaned up in this implementation.

## Testing

Update the existing GitHub events runtime tests to mock Graphile Worker instead of `pg-boss`.

Tests should cover:

- Lazy runner startup on enqueue.
- Collector and status jobs are both added for an event.
- `maxAttempts` is passed to added jobs.
- Task handlers call the existing collector/status functions.
- `TerminalEventError` is logged and does not throw from the task.
- Retryable errors still throw from the task.

Run the focused runtime tests and the package typecheck or test command that is practical for this branch.

## Dependency Changes

Replace `pg-boss` with `graphile-worker` in `packages/app/package.json` and update `pnpm-lock.yaml`.

Use the package manager already configured for this repo.

## Out Of Scope

- A separate worker service or process.
- New deployment topology.
- Exact compatibility with every `pg-boss` queue option.
- Cleanup of historical `pg-boss` database objects.
- Drizzle schema or migration generation.
