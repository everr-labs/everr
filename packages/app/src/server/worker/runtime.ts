import { EventEmitter } from "node:events";
import { startAppWorkers, stopAppWorkers } from "@app/workers";
import { run, type WorkerEvents } from "graphile-worker";
import { pool } from "@/db/client";
import { githubTasks } from "@/integrations/github/registration";
import { alertCronItems, alertTaskList } from "@/server/alerting/runtime";
import {
  previewsCronItems,
  previewsTaskList,
} from "@/server/previews/00-runtime";
import { registerShutdownHook } from "@/server/shutdown";
import { attachGraphileWorkerEventLogging } from "./events";
import { managedWorker } from "./managed-worker";

const general = managedWorker({
  name: "everrGeneralWorker",
  hot: import.meta.hot,
  start: async () => {
    const events = new EventEmitter() as WorkerEvents;
    attachGraphileWorkerEventLogging(events);
    const runner = await run({
      concurrency: 2,
      events,
      noHandleSignals: true,
      parsedCronItems: [...alertCronItems, ...previewsCronItems],
      pgPool: pool,
      taskList: {
        ...alertTaskList,
        ...(await githubTasks()),
        ...previewsTaskList,
      },
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

registerShutdownHook("worker.general", "workers", () => general.stop());
registerShutdownHook("worker.app", "workers", stopAppWorkers);

export async function startWorkerRuntime() {
  await Promise.all([general.start(), startAppWorkers()]);
  return {
    stop: async () => {
      await Promise.all([general.stop(), stopAppWorkers()]);
    },
  };
}
