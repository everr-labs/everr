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
import { alertCronItems, alertTaskList } from "@/server/alerts/runtime";
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

// HMR replaces this module while the previous runner is still alive, and the
// dispose hook is not awaited before the new instance evaluates. Keeping the
// handles on globalThis lets the replacement wait for the old runner to stop
// (two live runners double-poll the queue and keep stale task code running).
interface WorkerRuntimeState {
  starting?: Promise<Runner>;
  stopping?: Promise<void>;
}

const globalWithRuntime = globalThis as typeof globalThis & {
  __everrWorkerRuntime?: WorkerRuntimeState;
};
globalWithRuntime.__everrWorkerRuntime ??= {};
const workerState: WorkerRuntimeState = globalWithRuntime.__everrWorkerRuntime;

// A hung in-flight job must not keep the replacement runner down forever.
const STOP_TIMEOUT_MS = 15_000;

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
      "github_events.jobs.pool_listen_error",
      exceptionAttributes(error),
    );
  });

  events.on("pool:gracefulShutdown:error", ({ error }) => {
    serverLogger.error(
      "github_events.jobs.graceful_shutdown_error",
      exceptionAttributes(error),
    );
  });

  events.on("worker:getJob:error", ({ error }) => {
    serverLogger.error(
      "github_events.jobs.get_job_error",
      exceptionAttributes(error),
    );
  });

  events.on("worker:fatalError", ({ error, jobError }) => {
    serverLogger.error("github_events.jobs.worker_fatal_error", {
      ...exceptionAttributes(error),
      ...(jobError
        ? prefixedExceptionAttributes("job_exception", jobError)
        : {}),
    });
  });

  events.on("job:failed", ({ error, job }) => {
    serverLogger.error("github_events.jobs.job_failed", {
      ...exceptionAttributes(error),
      "graphile_worker.job.id": String(job.id),
      "graphile_worker.task.identifier": job.task_identifier,
    });
  });
}

type ParsedQueuedEvent = ReturnType<typeof parseQueuedWorkflowEvent>;

type WebhookTaskAction = (args: {
  body: Buffer;
  data: WebhookJobData;
  organizationId: string;
  parsed: ParsedQueuedEvent;
}) => Promise<void>;

function makeWebhookTask(
  spanName: string,
  terminalLogKey: string,
  action: WebhookTaskAction,
): Task {
  return async (payload, helpers) => {
    const data = payload as WebhookJobData;
    const eventType = firstHeader(data.headers, "x-github-event") ?? "";
    const body = Buffer.from(data.body, "base64");
    const parsed = parseQueuedWorkflowEvent(eventType, body);
    const jobId = helpers.job.id;

    await tracer.startActiveSpan(
      spanName,
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
          await action({ body, data, organizationId, parsed });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          span.recordException(err);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `${err.name}: ${err.message}`,
          });

          if (error instanceof TerminalEventError) {
            serverLogger.error(terminalLogKey, {
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
  };
}

const processCollectorTask = makeWebhookTask(
  "github_events.jobs.replay_webhook_to_collector",
  "github_events.jobs.collector_terminal_error",
  ({ body, data, organizationId }) =>
    replayWebhookToCollector({ headers: data.headers, body }, organizationId),
);

const processStatusTask = makeWebhookTask(
  "github_events.jobs.handle_status_event",
  "github_events.jobs.handle_status_terminal_error",
  ({ organizationId, parsed }) =>
    // biome-ignore lint/suspicious/noExplicitAny: db is badly typed
    handleStatusEvent(db as any, organizationId, parsed),
);

const TASK_LIST: TaskList = {
  [COLLECTOR_TASK_IDENTIFIER]: context.bind(ROOT_CONTEXT, processCollectorTask),
  [STATUS_TASK_IDENTIFIER]: context.bind(ROOT_CONTEXT, processStatusTask),
};

async function doStartRuntime(): Promise<Runner> {
  if (workerState.stopping) {
    await Promise.race([
      workerState.stopping,
      new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);
    workerState.stopping = undefined;
  }

  serverLogger.info("github_events.runtime.start");
  const events = new EventEmitter() as WorkerEvents;
  attachGraphileWorkerEventLogging(events);

  return run({
    concurrency: GH_EVENTS_CONFIG.workerCount,
    events,
    noHandleSignals: true,
    parsedCronItems: alertCronItems,
    pgPool: pool,
    taskList: { ...TASK_LIST, ...alertTaskList },
  });
}

export function startWorkerRuntime(): Promise<Runner> {
  workerState.starting ??= doStartRuntime();
  return workerState.starting;
}

export async function enqueueWebhookEvent(
  eventId: string,
  data: WebhookJobData,
): Promise<void> {
  const activeRunner = await startWorkerRuntime();

  await Promise.all(
    [COLLECTOR_TASK_IDENTIFIER, STATUS_TASK_IDENTIFIER].map((taskIdentifier) =>
      activeRunner.addJob(taskIdentifier, data, {
        jobKey: `${taskIdentifier}:${eventId}`,
        maxAttempts: GH_EVENTS_CONFIG.maxAttempts,
      }),
    ),
  );
}

async function stopWorkerRuntime(): Promise<void> {
  const starting = workerState.starting;
  workerState.starting = undefined;
  if (!starting) return;

  workerState.stopping = (async () => {
    const activeRunner = await starting.catch(() => undefined);
    await activeRunner?.stop();
  })().catch((error) => {
    serverLogger.error(
      "github_events.runtime.stop_failed",
      exceptionAttributes(error),
    );
  });
  await workerState.stopping;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // Not awaited by vite; the new instance waits on workerState.stopping.
    void stopWorkerRuntime();
  });
  // Self-accept so edits anywhere under the worker graph restart the runner
  // immediately, instead of leaving it stopped until the next HTTP request
  // happens to re-import server.ts.
  import.meta.hot.accept((newModule) => {
    void (
      newModule as typeof import("./runtime") | undefined
    )?.startWorkerRuntime();
  });
}
