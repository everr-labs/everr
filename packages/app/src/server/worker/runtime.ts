import { EventEmitter } from "node:events";
import { run, type WorkerEvents } from "graphile-worker";
import { pool } from "@/db/client";
import { alertCronItems, alertTaskList } from "@/server/alerting/runtime";
import { githubEventsTaskList } from "@/server/github-events/tasks";
import {
  startOrganizationWorker,
  stopOrganizationWorker,
} from "@/server/organization-provisioning/worker";
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
        ...githubEventsTaskList,
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
registerShutdownHook("worker.organizations", "workers", stopOrganizationWorker);

export async function startWorkerRuntime() {
  await Promise.all([general.start(), startOrganizationWorker()]);
  return {
    stop: async () => {
      await Promise.all([general.stop(), stopOrganizationWorker()]);
    },
  };
}
