import { EventEmitter } from "node:events";
import { run, type WorkerEvents } from "graphile-worker";
import { Pool } from "pg";
import { databasePoolConfig } from "#app/db/client.ts";
import { githubTasks } from "#app/integrations/github/registration.ts";
import { alertCronItems, alertTaskList } from "#app/server/alerting/runtime.ts";
import { previewsCronItems, previewsTaskList } from "#app/server/previews/00-runtime.ts";
import { attachGraphileWorkerEventLogging } from "./events";
import { managedWorker } from "./managed-worker";
import { combineWorkerTasks } from "./task-registration";

/** Product capabilities available to both self-hosted and cloud installations. */
export const productWorker = managedWorker({
  name: "everrGeneralWorker",
  hot: import.meta.hot,
  start: async () => {
    const tasks = combineWorkerTasks(
      { taskList: alertTaskList, parsedCronItems: alertCronItems },
      { taskList: await githubTasks(), parsedCronItems: [] },
      { taskList: previewsTaskList, parsedCronItems: previewsCronItems },
    );
    const events: WorkerEvents = new EventEmitter();
    attachGraphileWorkerEventLogging(events);
    // Graphile keeps one client for LISTEN and runs its notification handler
    // in the context that client's socket was opened in. A pool shared with
    // request and startup code could hand it a connection opened inside a
    // span, and every job it wakes would then join that trace.
    const pool = new Pool({ ...databasePoolConfig, max: 4 });
    try {
      const runner = await run({
        ...tasks,
        concurrency: 2,
        events,
        noHandleSignals: true,
        pgPool: pool,
      });
      let stopped = false;
      runner.events.on("stop", () => {
        stopped = true;
      });
      return {
        promise: runner.promise,
        stop: async () => {
          try {
            if (!stopped) await runner.stop();
          } finally {
            await pool.end();
          }
        },
      };
    } catch (error) {
      await pool.end();
      throw error;
    }
  },
});
