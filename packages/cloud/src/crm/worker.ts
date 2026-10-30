import { EventEmitter } from "node:events";
import { databasePoolConfig } from "@everr/app/db/client";
import * as schema from "@everr/app/db/schema";
import { managedWorker } from "@everr/app/server/worker/managed-worker";
import { drizzle } from "drizzle-orm/node-postgres";
import { run, type TaskList, type WorkerEvents } from "graphile-worker";
import { Pool } from "pg";
import { appEnv } from "../app/env";
import { createBrevoAdapter } from "./brevo/adapter";
import { createCrmSnapshotReader } from "./snapshots";
import { createCrmTaskList } from "./task-list";

export const integrationWorker = managedWorker({
  name: "everrIntegrationWorker",
  hot: import.meta.hot,
  async start() {
    if (appEnv.CRM_BREVO_MODE !== "configured" || !appEnv.CRM_BREVO_API_KEY)
      throw new Error("CRM integration runner is not configured.");
    const pool = new Pool({ ...databasePoolConfig, max: 4 });
    const database = drizzle(pool, { schema });
    const controller = new AbortController();
    const events: WorkerEvents = new EventEmitter();
    try {
      const tasks = createCrmTaskList({
        database,
        reader: createCrmSnapshotReader(database),
        adapter: createBrevoAdapter({
          apiKey: appEnv.CRM_BREVO_API_KEY,
          timeoutMs: appEnv.CRM_BREVO_TIMEOUT_MS,
        }),
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
