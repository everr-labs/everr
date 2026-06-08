import { EventEmitter } from "node:events";
import {
  context,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import {
  type Runner,
  run,
  type Task,
  type TaskList,
  type WorkerEvents,
} from "graphile-worker";
import { db, pool } from "@/db/client";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { getTelemetryTracer } from "@/telemetry/node";
import { replayWebhookToCollector } from "./collector";
import { GH_EVENTS_CONFIG } from "./config";
import { firstHeader } from "./headers";
import {
  installationIdFromQueuedEvent,
  parseQueuedWorkflowEvent,
} from "./payloads";
import { handleStatusEvent } from "./status-writer";
import { resolveOrganizationId } from "./tenant-resolver";
import type { WebhookJobData } from "./types";
import { TerminalEventError } from "./types";

const COLLECTOR_TASK_IDENTIFIER = "github-events/collector";
const STATUS_TASK_IDENTIFIER = "github-events/status";
const tracer = getTelemetryTracer("everr-app.github_events");

let runner: Runner | undefined;

type GraphileTaskHelpers = Parameters<Task>[1];

function getRunner(): Runner | undefined {
  return runner;
}

function webhookJobData(payload: unknown): WebhookJobData {
  return payload as WebhookJobData;
}

function graphileJobId(helpers: GraphileTaskHelpers): string {
  const job = helpers.job as { id?: number | string; uuid?: string };
  return String(job.id ?? job.uuid ?? "unknown");
}

function prefixedExceptionAttributes(prefix: string, reason: unknown) {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  return {
    [`${prefix}.message`]: error.message,
    [`${prefix}.type`]: error.name,
  };
}

function attachGraphileWorkerEventLogging(events: WorkerEvents): void {
  events.on("pool:listen:error", ({ error }) => {
    serverLogger.error(
      "github_events.graphile_worker.pool_listen_error",
      exceptionAttributes(error),
    );
  });

  events.on("pool:gracefulShutdown:error", ({ error }) => {
    serverLogger.error(
      "github_events.graphile_worker.graceful_shutdown_error",
      exceptionAttributes(error),
    );
  });

  events.on("worker:getJob:error", ({ error }) => {
    serverLogger.error(
      "github_events.graphile_worker.get_job_error",
      exceptionAttributes(error),
    );
  });

  events.on("worker:fatalError", ({ error, jobError }) => {
    serverLogger.error("github_events.graphile_worker.worker_fatal_error", {
      ...exceptionAttributes(error),
      ...(jobError
        ? prefixedExceptionAttributes("job_exception", jobError)
        : {}),
    });
  });

  events.on("job:failed", ({ error, job }) => {
    serverLogger.error("github_events.graphile_worker.job_failed", {
      ...exceptionAttributes(error),
      "graphile_worker.job.id": String(job.id),
      "graphile_worker.task.identifier": job.task_identifier,
    });
  });
}

async function processCollectorTask(
  payload: unknown,
  helpers: GraphileTaskHelpers,
): Promise<void> {
  const data = webhookJobData(payload);
  const eventType = firstHeader(data.headers, "x-github-event") ?? "";
  const body = Buffer.from(data.body, "base64");
  const parsed = parseQueuedWorkflowEvent(eventType, body);
  const jobId = graphileJobId(helpers);

  await tracer.startActiveSpan(
    "replay github webhook to collector",
    {
      attributes: {
        ...(eventType ? { "github.event.type": eventType } : {}),
        "graphile_worker.job.id": jobId,
      },
      kind: SpanKind.INTERNAL,
    },
    async (span) => {
      try {
        const installationId = installationIdFromQueuedEvent(parsed);
        const organizationId = await resolveOrganizationId(installationId);
        await replayWebhookToCollector(
          { headers: data.headers, body },
          organizationId,
        );
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `${err.name}: ${err.message}`,
        });

        if (error instanceof TerminalEventError) {
          serverLogger.error("github_events.collector.terminal_error", {
            ...(eventType ? { "github.event.type": eventType } : {}),
            ...exceptionAttributes(error),
            "graphile_worker.job.id": jobId,
          });
          return;
        }

        throw error;
      } finally {
        span.end();
      }
    },
  );
}

async function processStatusTask(
  payload: unknown,
  helpers: GraphileTaskHelpers,
): Promise<void> {
  const data = webhookJobData(payload);
  const eventType = firstHeader(data.headers, "x-github-event") ?? "";
  const body = Buffer.from(data.body, "base64");
  const parsed = parseQueuedWorkflowEvent(eventType, body);
  const jobId = graphileJobId(helpers);

  await tracer.startActiveSpan(
    "handle github status event",
    {
      attributes: {
        ...(eventType ? { "github.event.type": eventType } : {}),
        "graphile_worker.job.id": jobId,
      },
      kind: SpanKind.INTERNAL,
    },
    async (span) => {
      try {
        const installationId = installationIdFromQueuedEvent(parsed);
        const organizationId = await resolveOrganizationId(installationId);
        // biome-ignore lint/suspicious/noExplicitAny: db is badly typed
        await handleStatusEvent(db as any, organizationId, parsed);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `${err.name}: ${err.message}`,
        });

        if (error instanceof TerminalEventError) {
          serverLogger.error("github_events.status.terminal_error", {
            ...(eventType ? { "github.event.type": eventType } : {}),
            ...exceptionAttributes(error),
            "graphile_worker.job.id": jobId,
          });
          return;
        }

        throw error;
      } finally {
        span.end();
      }
    },
  );
}

const TASK_LIST: TaskList = {
  [COLLECTOR_TASK_IDENTIFIER]: context.bind(ROOT_CONTEXT, processCollectorTask),
  [STATUS_TASK_IDENTIFIER]: context.bind(ROOT_CONTEXT, processStatusTask),
};

async function startGitHubEventsRuntime(): Promise<Runner> {
  if (runner) return runner;

  serverLogger.info("github_events.runtime.start");
  const events = new EventEmitter() as WorkerEvents;
  attachGraphileWorkerEventLogging(events);

  runner = await run({
    concurrency: GH_EVENTS_CONFIG.workerCount,
    events,
    noHandleSignals: true,
    parsedCronItems: [],
    pgPool: pool,
    taskList: TASK_LIST,
  });

  return runner;
}

export async function enqueueWebhookEvent(
  eventId: string,
  data: WebhookJobData,
): Promise<void> {
  let activeRunner = getRunner();
  if (!activeRunner) {
    activeRunner = await startGitHubEventsRuntime();
  }

  await Promise.all([
    activeRunner.addJob(COLLECTOR_TASK_IDENTIFIER, data, {
      jobKey: `${COLLECTOR_TASK_IDENTIFIER}:${eventId}`,
      maxAttempts: GH_EVENTS_CONFIG.maxAttempts,
    }),
    activeRunner.addJob(STATUS_TASK_IDENTIFIER, data, {
      jobKey: `${STATUS_TASK_IDENTIFIER}:${eventId}`,
      maxAttempts: GH_EVENTS_CONFIG.maxAttempts,
    }),
  ]);
}

async function stopGitHubEventsRuntime(): Promise<void> {
  const activeRunner = runner;
  runner = undefined;
  await activeRunner?.stop();
}

if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    await stopGitHubEventsRuntime();
  });
}
