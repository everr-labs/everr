import type { Task } from "graphile-worker";
import type { Pool } from "pg";
import { bootstrapCrm, CrmAdmissionDeferred } from "./bootstrap";
import { reconciliationDiagnostic } from "./telemetry";

export const RECONCILIATION_TASK = "crm/reconcile";

/** One short page per minute, below live work. Replicas serialize checkpoint commits.
 * A cycle repeats 24 hours after completed admission, never claiming remote convergence.
 */
export function createReconciliationTask(options: {
  pool: Pool;
  mode: "disabled" | "paused" | "configured";
  deployment: string;
  accountScope: string;
  diagnostic?: typeof reconciliationDiagnostic;
}): Task {
  const report = options.diagnostic ?? reconciliationDiagnostic;
  return async (_raw, helpers) => {
    if (options.mode !== "configured") {
      report("deferred");
      return;
    }
    let age: number | undefined;
    try {
      const pending = await options.pool.query<{ age: number | null }>(
        `SELECT extract(epoch FROM now() - min(since))::double precision AS age FROM (
           SELECT pending_since AS since FROM crm_projection
           WHERE deployment = $1 AND synced_revision IS DISTINCT FROM desired_revision
           UNION ALL
           SELECT created_at AS since FROM graphile_worker.jobs
           WHERE task_identifier IN ('crm/sync-user', 'crm/sync-organization', 'crm/sync-membership')
           AND attempts < max_attempts
         ) AS known_pending`,
        [options.deployment],
      );
      age = Math.max(0, pending.rows[0]?.age ?? 0);
      const progress = await bootstrapCrm({
        ...options,
        pageSize: 10,
        maxPages: 1,
        periodic: true,
        signal: helpers.abortSignal,
      });
      report("progress", {
        pages: progress.pages,
        admitted: progress.admitted,
        oldestKnownPendingSeconds: age,
      });
    } catch (error) {
      if (error instanceof CrmAdmissionDeferred) {
        report("deferred", { oldestKnownPendingSeconds: age });
        return;
      }
      report("failure");
      // Database errors can contain SQL parameters. Graphile retains its bounded fallback.
      // eslint-disable-next-line preserve-caught-error -- Raw database causes may contain profile data.
      throw new Error("CRM reconciliation failed; committed progress remains resumable.");
    }
  };
}
