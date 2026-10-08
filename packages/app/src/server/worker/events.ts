import { performance } from "node:perf_hooks";
import { metrics } from "@opentelemetry/api";
import type { WorkerEvents } from "graphile-worker";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

const meter = metrics.getMeter("everr-app.worker");
const activeJobs = meter.createUpDownCounter("worker.jobs.active", {
  description: "Number of jobs currently being processed",
});

function prefixedExceptionAttributes(prefix: string, reason: unknown) {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  return {
    [`${prefix}.message`]: error.message,
    [`${prefix}.type`]: error.name,
  };
}

export function attachGraphileWorkerEventLogging(
  events: WorkerEvents,
  logTerminalFailures = true,
): void {
  const startedAtByJobId = new Map<string, number>();

  events.on("job:start", ({ job }) => {
    startedAtByJobId.set(String(job.id), performance.now());
    activeJobs.add(1);
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
    activeJobs.add(-1);
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
    if (!logTerminalFailures) return;
    serverLogger.error("worker.jobs.job_failed", {
      ...exceptionAttributes(error),
      "graphile_worker.job.id": String(job.id),
      "graphile_worker.job.name": job.task_identifier,
      "graphile_worker.task.identifier": job.task_identifier,
    });
  });
}
