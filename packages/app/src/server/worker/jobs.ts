import {
  makeWorkerUtils,
  type TaskSpec,
  type WorkerUtils,
} from "graphile-worker";
import { pool } from "@/db/client";

// One long-lived WorkerUtils, kept on globalThis so HMR module replacement
// doesn't accumulate one per edit. Callers enqueue through graphile-worker's
// public API rather than hand-written `graphile_worker.add_job` SQL.
const globalWithUtils = globalThis as typeof globalThis & {
  __everrWorkerUtils?: Promise<WorkerUtils>;
};

function getWorkerUtils(): Promise<WorkerUtils> {
  globalWithUtils.__everrWorkerUtils ??= makeWorkerUtils({ pgPool: pool });
  return globalWithUtils.__everrWorkerUtils;
}

export async function addWorkerJob(
  identifier: string,
  payload: unknown,
  spec?: TaskSpec,
): Promise<void> {
  const utils = await getWorkerUtils();
  await utils.addJob(identifier, payload, spec);
}
