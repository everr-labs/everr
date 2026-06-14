import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
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
  const startedAtByJobId = new Map<string, number>();

  events.on("job:start", ({ job }) => {
    startedAtByJobId.set(String(job.id), performance.now());
  });

  events.on("job:success", ({ job, worker }) => {
    const jobId = String(job.id);
    const startedAt = startedAtByJobId.get(jobId);
    startedAtByJobId.delete(jobId);

    serverLogger.info("worker.jobs.job_completed", {
      ...(startedAt === undefined
        ? {}
        : { "graphile_worker.job.duration_ms": performance.now() - startedAt }),
      "graphile_worker.job.attempts": job.attempts,
      "graphile_worker.job.id": jobId,
      "graphile_worker.job.max_attempts": job.max_attempts,
      "graphile_worker.job.name": job.task_identifier,
      "graphile_worker.task.identifier": job.task_identifier,
      "graphile_worker.worker.id": worker.workerId,
    });
  });

  events.on("job:complete", ({ job }) => {
    startedAtByJobId.delete(String(job.id));
  });

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
      "graphile_worker.job.name": job.task_identifier,
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
