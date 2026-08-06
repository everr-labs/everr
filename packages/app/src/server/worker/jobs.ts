import { sql } from "drizzle-orm";
import {
  makeWorkerUtils,
  type TaskSpec,
  type WorkerUtils,
} from "graphile-worker";
import type { Transaction } from "@/db/client";
import { pool } from "@/db/client";

// One long-lived WorkerUtils, memoized like the pool it attaches to. It is a
// stateless enqueue client with no logic worth hot-reloading, so plain
// module-level memoization is enough. Callers enqueue through graphile-worker's
// public API rather than hand-written `graphile_worker.add_job` SQL.
let workerUtils: Promise<WorkerUtils> | undefined;

function getWorkerUtils(): Promise<WorkerUtils> {
  workerUtils ??= makeWorkerUtils({ pgPool: pool });
  return workerUtils;
}

export async function addWorkerJob(
  identifier: string,
  payload: unknown,
  spec?: TaskSpec,
): Promise<void> {
  const utils = await getWorkerUtils();
  await utils.addJob(identifier, payload, spec);
}

export async function addWorkerJobInTransaction(
  tx: Transaction,
  identifier: string,
  payload: unknown,
  spec: TaskSpec = {},
): Promise<void> {
  await tx.execute(sql`
    SELECT graphile_worker.add_job(
      ${identifier},
      ${JSON.stringify(payload)}::json,
      queue_name := ${spec.queueName ?? null},
      run_at := ${spec.runAt ?? new Date()},
      max_attempts := ${spec.maxAttempts ?? 25},
      job_key := ${spec.jobKey ?? null},
      priority := ${spec.priority ?? 0},
      flags := ${spec.flags ?? null},
      job_key_mode := ${spec.jobKeyMode ?? "replace"}
    )
  `);
}
