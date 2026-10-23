import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { databasePoolConfig } from "@everr/app/db/client";
import * as schema from "@everr/app/db/schema";
import { managedWorker } from "@everr/app/server/worker/managed-worker";
import { drizzle } from "drizzle-orm/node-postgres";
import { run, type TaskList, type WorkerEvents } from "graphile-worker";
import { Pool } from "pg";
import { createBrevoAdapter } from "./brevo/adapter";
import { createBrevoBudget, type BrevoBudget } from "./brevo/budget";
import { readBrevoConfig } from "./brevo/config";
import { createCrmSnapshotReader } from "./snapshots";
import { createCrmProjectionStore } from "./store";
import { createCrmTaskList } from "./task-list";
import { attachCrmRetryPolicy } from "./retries";

/** Avoid GET/defer starvation for the ordinary 100ms contact permit gap.
 * Longer cooldowns are returned immediately to the persisted scheduling path.
 */
export function contactPermitGap(budget: BrevoBudget, signal: AbortSignal): BrevoBudget {
  return {
    cooldown: (group, delayMs) => budget.cooldown(group, delayMs),
    async acquire(group) {
      const permit = await budget.acquire(group);
      if (permit.allowed || group !== "contacts") return permit;
      const waitMs = permit.retryAt.getTime() - Date.now();
      if (waitMs < 0 || waitMs > 250) return permit;
      await delay(Math.min(250, waitMs + 1), undefined, { signal });
      return budget.acquire(group);
    },
  };
}

export const integrationWorker = managedWorker({
  name: "everrIntegrationWorker",
  hot: import.meta.hot,
  async start() {
    const config = readBrevoConfig(process.env);
    if (config.mode !== "configured") throw new Error("CRM integration runner is not configured.");
    const pool = new Pool({ ...databasePoolConfig, max: 4 });
    const database = drizzle(pool, { schema });
    const controller = new AbortController();
    const events: WorkerEvents = new EventEmitter();
    const retries = attachCrmRetryPolicy(events, pool);
    try {
      const tasks = createCrmTaskList({
        pool,
        deployment: config.deployment,
        reader: createCrmSnapshotReader(database, config.deployment),
        store: createCrmProjectionStore(database, config.deployment),
        adapter: createBrevoAdapter(
          config,
          contactPermitGap(createBrevoBudget(database, config.accountScope), controller.signal),
        ),
      });
      const taskList: TaskList = {};
      for (const [name, task] of Object.entries(tasks)) {
        if (task)
          taskList[name] = (payload, helpers) =>
            task(payload, { ...helpers, abortSignal: controller.signal });
      }
      const runner = await run({
        concurrency: 1,
        pgPool: pool,
        events,
        noHandleSignals: true,
        pollInterval: 1000,
        taskList,
        preset: { worker: { gracefulShutdownAbortTimeout: 5000 } },
      });
      let stopped = false;
      runner.events.on("stop", () => {
        stopped = true;
      });
      return {
        promise: runner.promise,
        async stop() {
          controller.abort();
          try {
            if (!stopped) await runner.stop();
          } finally {
            await retries.drain();
            await pool.end();
          }
        },
      };
    } catch (error) {
      controller.abort();
      await pool.end();
      throw error;
    }
  },
});
