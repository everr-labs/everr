import { serverLogger } from "@everr/app/telemetry/logger";
import type { WorkerEvents } from "graphile-worker";
import type { Pool } from "pg";
import { USER_SYNC_TASK, ORGANIZATION_SYNC_TASK, MEMBERSHIP_SYNC_TASK } from "./commands";
import { RetainedCrmWork } from "./coordination";

/** Native retries protect DB/continuation failures; known terminal work stays inspectable.
 * A crash before this optimization runs leaves native retry intact. The handler then
 * observes blocked state/exhausted payload without another provider write.
 */
export function attachCrmRetryPolicy(events: WorkerEvents, pool: Pick<Pool, "query">) {
  const pending = new Set<Promise<void>>();
  events.on("job:complete", ({ job, error }) => {
    if (
      ![USER_SYNC_TASK, ORGANIZATION_SYNC_TASK, MEMBERSHIP_SYNC_TASK].includes(
        job.task_identifier,
      ) ||
      !(error instanceof RetainedCrmWork)
    )
      return;
    const update = pool
      .query("SELECT graphile_worker.permanently_fail_jobs(ARRAY[$1::bigint], $2)", [
        String(job.id),
        error.message,
      ])
      .then(() => undefined)
      .catch(() => {
        serverLogger.error("crm.retry.retention.failed", { "everr.worker.job.id": String(job.id) });
      });
    pending.add(update);
    void update.finally(() => pending.delete(update));
  });
  return {
    async drain() {
      await Promise.all(pending);
    },
  };
}
