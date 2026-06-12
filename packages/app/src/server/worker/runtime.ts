import { EventEmitter } from "node:events";
import { type Runner, run, type WorkerEvents } from "graphile-worker";
import { pool } from "@/db/client";
import { alertCronItems, alertTaskList } from "@/server/alerts/runtime";
import { githubEventsTaskList } from "@/server/github-events/tasks";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

const WORKER_CONCURRENCY = 2;

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
      "worker.jobs.pool_listen_error",
      exceptionAttributes(error),
    );
  });

  events.on("pool:gracefulShutdown:error", ({ error }) => {
    serverLogger.error(
      "worker.jobs.graceful_shutdown_error",
      exceptionAttributes(error),
    );
  });

  events.on("worker:getJob:error", ({ error }) => {
    serverLogger.error("worker.jobs.get_job_error", exceptionAttributes(error));
  });

  events.on("worker:fatalError", ({ error, jobError }) => {
    serverLogger.error("worker.jobs.worker_fatal_error", {
      ...exceptionAttributes(error),
      ...(jobError
        ? prefixedExceptionAttributes("job_exception", jobError)
        : {}),
    });
  });

  events.on("job:failed", ({ error, job }) => {
    serverLogger.error("worker.jobs.job_failed", {
      ...exceptionAttributes(error),
      "graphile_worker.job.id": String(job.id),
      "graphile_worker.task.identifier": job.task_identifier,
    });
  });
}

async function doStartRuntime(): Promise<Runner> {
  if (workerState.stopping) {
    await Promise.race([
      workerState.stopping,
      new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);
    workerState.stopping = undefined;
  }

  serverLogger.info("worker.runtime.start");
  const events = new EventEmitter() as WorkerEvents;
  attachGraphileWorkerEventLogging(events);

  return run({
    concurrency: WORKER_CONCURRENCY,
    events,
    noHandleSignals: true,
    parsedCronItems: alertCronItems,
    pgPool: pool,
    taskList: { ...githubEventsTaskList, ...alertTaskList },
  });
}

export function startWorkerRuntime(): Promise<Runner> {
  workerState.starting ??= doStartRuntime();
  return workerState.starting;
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
      "worker.runtime.stop_failed",
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
