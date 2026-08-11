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

/**
 * Why this file drives jobs itself instead of calling graphile-worker's own
 * SQL.
 *
 * Every one of graphile's statements dates its work with the database's
 * `now()`. The harness fakes `Date` in JavaScript only, so `now()` inside
 * PGlite still returns the real wall clock. A claim that asked graphile which
 * jobs are due would compare a real `now()` against `run_at` values this suite
 * wrote from a clock pinned to 2026, and would answer about a timeline no test
 * is on. Every date this file compares or writes therefore comes in as a bound
 * parameter from the faked clock.
 *
 * Version note: 0.16.6 has no `fail_job` function left to call. Retrying is
 * inlined from `dist/sql/failJob.js` at runtime, and the only surviving
 * failure function, `permanently_fail_jobs`, sets `attempts = max_attempts`
 * with no backoff at all.
 */
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
      const message = cause instanceof Error ? cause.message : String(cause);
      // graphile's own retry expression, copied from `dist/sql/failJob.js`
      // with `now()` replaced by the faked clock, so a test that counts
      // attempts over time counts the intervals production would space them
      // by. `SET` reads the row's old values, so `attempts + 1` is the count
      // this failure produces, which is the number graphile raises to as
      // well: it increments on claim (`dist/sql/getJob.js`) rather than on
      // failure, and then backs off by `least(attempts, 10)`.
      // BACKOFF_EXPRESSION_TEST covers the copy against the shipped file.
      await db.execute(sql`
        UPDATE graphile_worker._private_jobs
        SET attempts = attempts + 1,
            last_error = ${message},
            run_at = greatest(${now}::timestamptz, run_at)
                     + (exp(least(attempts + 1, 10)) * interval '1 second')
        WHERE id = ${job.id}::bigint
      `);
    }
  }
  throw new Error(
    `job driver ran ${limit} jobs without draining: suspect a job that re-enqueues itself`,
  );
}

/**
 * The part of graphile's retry statement this file copies. A version bump that
 * changes the backoff curve changes this string, and the test that reads it
 * out of the installed package fails, which is the only warning a copied
 * expression can give.
 */
export const BACKOFF_EXPRESSION_TEST =
  "exp(least(attempts, 10)) * interval '1 second'";

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
    // pglite's raw execute() hands back a timestamp column as the text wire
    // value, not a parsed Date, unlike the typed select() builder path. The
    // return type above promises Date; make good on it here rather than at
    // every call site.
    runAt: new Date(row.run_at),
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
