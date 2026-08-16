import { sql } from "drizzle-orm";
import type { TaskSpec } from "graphile-worker";
import { type DbExecutor, db, type Transaction } from "@/db/client";

// One statement for both paths. graphile's `add_job` is the public enqueue
// API and is transaction-safe, so a job committed with the mutation that
// scheduled it and a job enqueued on its own take the identical route.
//
// A spec with no `runAt` sends NULL rather than a JavaScript date, because
// `add_job` writes `coalesce(run_at, now())`: a job that means "as soon as
// possible" is dated by the database, and a skewed app node cannot schedule
// it early or late.
function addJob(
  executor: DbExecutor,
  identifier: string,
  payload: unknown,
  spec: TaskSpec,
): Promise<unknown> {
  return executor.execute(sql`
    SELECT graphile_worker.add_job(
      ${identifier},
      ${JSON.stringify(payload)}::json,
      queue_name := ${spec.queueName ?? null},
      run_at := ${spec.runAt ?? null}::timestamptz,
      max_attempts := ${spec.maxAttempts ?? 25},
      job_key := ${spec.jobKey ?? null},
      priority := ${spec.priority ?? 0},
      flags := ${spec.flags ?? null},
      job_key_mode := ${spec.jobKeyMode ?? "replace"}
    )
  `);
}

export async function addWorkerJob(
  identifier: string,
  payload: unknown,
  spec: TaskSpec = {},
): Promise<void> {
  await addJob(db, identifier, payload, spec);
}

export async function addWorkerJobInTransaction(
  tx: Transaction,
  identifier: string,
  payload: unknown,
  spec: TaskSpec = {},
): Promise<void> {
  await addJob(tx, identifier, payload, spec);
}
