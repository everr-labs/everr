import { EventEmitter } from "node:events";
import { run, type WorkerEvents } from "graphile-worker";
import { pool } from "#app/db/client.ts";
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
        if (!stopped) await runner.stop();
      },
    };
  },
});
