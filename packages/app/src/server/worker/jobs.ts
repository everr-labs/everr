import {
  makeWorkerUtils,
  type TaskSpec,
  type WorkerUtils,
} from "graphile-worker";
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
