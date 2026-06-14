import { EventEmitter } from "node:events";
import { type Runner, run, type WorkerEvents } from "graphile-worker";
import { pool } from "@/db/client";
import { alertCronItems, alertTaskList } from "@/server/alerts/00-runtime";
import { githubEventsTaskList } from "@/server/github-events/tasks";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { hotSingleton } from "./hot-singleton";

const WORKER_CONCURRENCY = 2;

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

async function startRunner(): Promise<Runner> {
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

const runtime = hotSingleton<Runner>({
  key: "everrWorkerRuntime",
  start: startRunner,
  stop: (runner) => runner.stop(),
  hot: import.meta.hot,
  onError: (error) =>
    serverLogger.error(
      "worker.runtime.stop_failed",
      exceptionAttributes(error),
    ),
});

export function startWorkerRuntime(): Promise<Runner> {
  return runtime.start();
}
