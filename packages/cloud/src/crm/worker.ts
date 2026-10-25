import { EventEmitter } from "node:events";
import { databasePoolConfig } from "@everr/app/db/client";
import * as schema from "@everr/app/db/schema";
import { managedWorker } from "@everr/app/server/worker/managed-worker";
import { drizzle } from "drizzle-orm/node-postgres";
import { parseCronItems, run, type TaskList, type WorkerEvents } from "graphile-worker";
import { Pool } from "pg";
import { createBrevoAdapter } from "./brevo/adapter";
import { createBrevoBudget } from "./brevo/budget";
import { readBrevoConfig } from "./brevo/config";
import { createCrmSnapshotReader } from "./snapshots";
import { createCrmProjectionStore } from "./store";
import { createCrmTaskList } from "./task-list";
import { createReconciliationTask, RECONCILIATION_TASK } from "./reconciliation";
import { attachCrmRetryPolicy } from "./retries";

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
        adapter: createBrevoAdapter(config, createBrevoBudget(database, config.accountScope)),
      });
      const taskList: TaskList = {};
      for (const [name, task] of Object.entries(tasks)) {
        if (task)
          taskList[name] = (payload, helpers) =>
            task(payload, { ...helpers, abortSignal: controller.signal });
      }
      const reconcile = createReconciliationTask({ pool, ...config });
      taskList[RECONCILIATION_TASK] = (payload, helpers) =>
        reconcile(payload, { ...helpers, abortSignal: controller.signal });
      const runner = await run({
        parsedCronItems: parseCronItems([
          {
            task: RECONCILIATION_TASK,
            match: "* * * * *",
            options: {
              backfillPeriod: 0,
              priority: 100,
              maxAttempts: 3,
              jobKey: "crm-reconcile",
              jobKeyMode: "preserve_run_at",
            },
          },
        ]),
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
