import type { WorkerEvents } from "graphile-worker";
import type { Pool } from "pg";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import {
  DEPROVISION_ORGANIZATION_TASK,
  ORGANIZATION_MAX_ATTEMPTS,
  PROVISION_ORGANIZATION_TASK,
} from "./jobs";

const ORGANIZATION_RETRY_CAP_SECONDS = 30;

export function organizationRetryDelaySeconds(attempts: number): number {
  const base = Math.min(
    ORGANIZATION_RETRY_CAP_SECONDS,
    2 ** Math.min(attempts, 5),
  );
  // Jitter only shortens the delay, so the advertised cap stays a hard cap.
  return base * (0.8 + Math.random() * 0.2);
}

const lifecycleTasks = [
  PROVISION_ORGANIZATION_TASK,
  DEPROVISION_ORGANIZATION_TASK,
];

export function attachOrganizationRetryPolicy(
  events: WorkerEvents,
  pgPool: Pick<Pool, "query">,
) {
  const pending = new Set<Promise<void>>();

  // job:complete fires after Graphile has persisted the failure and unlocked
  // the job. Rescheduling earlier would either be ignored or overwritten by
  // its default backoff. Keep the job, error and attempt count intact.
  events.on("job:complete", ({ job, error }) => {
    if (
      error == null ||
      !lifecycleTasks.includes(job.task_identifier) ||
      job.attempts >= job.max_attempts
    )
      return;
    const update = pgPool
      .query(
        `SELECT graphile_worker.reschedule_jobs(
        ARRAY[$1::bigint],
        run_at := now() + ($2::double precision * interval '1 second'),
        max_attempts := $3
      )`,
        [
          String(job.id),
          organizationRetryDelaySeconds(job.attempts),
          ORGANIZATION_MAX_ATTEMPTS,
        ],
      )
      .then(() => undefined)
      .catch((reason: unknown) => {
        serverLogger.error("sql_api.org_user.retry_schedule.failed", {
          ...exceptionAttributes(reason),
          "everr.worker.job.id": String(job.id),
        });
      });
    pending.add(update);
    void update.finally(() => pending.delete(update));
  });

  return {
    async capPendingRetries() {
      // Covers old deployments and a process dying between failure persistence
      // and the completion listener's reschedule. Use only Graphile's public
      // view and API, which leave currently locked jobs alone.
      await pgPool.query(
        `SELECT graphile_worker.reschedule_jobs(
          ARRAY[j.id],
          run_at := least(j.run_at, now() + ($2::double precision * interval '1 second')),
          max_attempts := $3
        ) FROM graphile_worker.jobs j
        WHERE j.task_identifier = ANY($1::text[])
          AND j.attempts > 0 AND j.attempts < j.max_attempts
          AND (j.run_at > now() + ($2::double precision * interval '1 second')
            OR j.max_attempts < $3)`,
        [
          lifecycleTasks,
          ORGANIZATION_RETRY_CAP_SECONDS,
          ORGANIZATION_MAX_ATTEMPTS,
        ],
      );
    },
    async drain() {
      await Promise.all([...pending]);
    },
  };
}
