import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type * as schema from "@/db/schema";
import { alertTaskList } from "@/server/alerting/runtime";

type Db = PgliteDatabase<typeof schema>;

// A type alias, not an interface: db.execute<T>'s constraint is
// Record<string, unknown>, and only a type alias's object type picks up the
// implicit index signature that satisfies it.
type DueJob = {
  id: string;
  identifier: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
};

// graphile's own backoff, so a test that counts attempts over time counts the
// same intervals production does.
function backoffSeconds(attempts: number): number {
  return Math.exp(Math.min(10, attempts));
}

async function claimNextDueJob(db: Db, now: Date): Promise<DueJob | undefined> {
  const result = await db.execute<DueJob>(sql`
    SELECT j.id::text AS id,
           t.identifier AS identifier,
           j.payload AS payload,
           j.attempts AS attempts,
           j.max_attempts AS max_attempts
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
    WHERE j.run_at <= ${now}
      AND j.attempts < j.max_attempts
    ORDER BY j.priority, j.run_at, j.id
    LIMIT 1
  `);
  return result.rows[0];
}

/**
 * Runs every job that is due, one at a time, until none is. A handler that
 * enqueues more work is picked up by the same loop, so one call drains a
 * whole cascade: evaluate, then process event, then flush group, then send.
 */
export async function runDueJobs(
  db: Db,
  opts: { now?: Date; limit?: number } = {},
): Promise<number> {
  const limit = opts.limit ?? 500;
  let ran = 0;
  for (; ran < limit; ) {
    const now = opts.now ?? new Date();
    const job = await claimNextDueJob(db, now);
    if (!job) return ran;
    ran += 1;
    const handler = alertTaskList[job.identifier];
    if (!handler) {
      throw new Error(`no handler registered for task ${job.identifier}`);
    }
    try {
      await handler(job.payload, {} as never);
      await db.execute(
        sql`DELETE FROM graphile_worker._private_jobs WHERE id = ${job.id}::bigint`,
      );
    } catch (cause) {
      const attempts = job.attempts + 1;
      const message = cause instanceof Error ? cause.message : String(cause);
      await db.execute(sql`
        UPDATE graphile_worker._private_jobs
        SET attempts = ${attempts},
            last_error = ${message},
            run_at = ${new Date(
              now.getTime() + backoffSeconds(attempts) * 1_000,
            )}
        WHERE id = ${job.id}::bigint
      `);
    }
  }
  throw new Error(
    `job driver ran ${limit} jobs without draining: suspect a job that re-enqueues itself`,
  );
}

export async function pendingJobs(db: Db) {
  const result = await db.execute<{
    identifier: string;
    payload: unknown;
    run_at: Date;
    attempts: number;
  }>(sql`
    SELECT t.identifier, j.payload, j.run_at, j.attempts
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
    WHERE j.attempts < j.max_attempts
    ORDER BY j.run_at, j.id
  `);
  return result.rows.map((row) => ({
    identifier: row.identifier,
    payload: row.payload,
    runAt: row.run_at,
    attempts: row.attempts,
  }));
}

export async function failedJobs(db: Db) {
  const result = await db.execute<{
    identifier: string;
    attempts: number;
    last_error: string;
  }>(sql`
    SELECT t.identifier, j.attempts, j.last_error
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
    WHERE j.attempts >= j.max_attempts
    ORDER BY j.id
  `);
  return result.rows.map((row) => ({
    identifier: row.identifier,
    attempts: row.attempts,
    lastError: row.last_error,
  }));
}
