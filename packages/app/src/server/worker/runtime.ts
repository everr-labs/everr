import { EventEmitter } from "node:events";
import { server } from "@composition/server";
import { run, type WorkerEvents } from "graphile-worker";
import { pool } from "#app/db/client.ts";
import { githubTasks } from "#app/integrations/github/registration.ts";
import { alertCronItems, alertTaskList } from "#app/server/alerting/runtime.ts";
import {
  previewsCronItems,
  previewsTaskList,
} from "#app/server/previews/00-runtime.ts";
import { registerShutdownHook } from "#app/server/shutdown.ts";
import { attachGraphileWorkerEventLogging } from "./events";
import { managedWorker } from "./managed-worker";

const { startAppWorkers } = server;

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

export async function startWorkerRuntime() {
  const application = Promise.resolve().then(() => startAppWorkers());
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      const results = await Promise.allSettled([
        general.stop(),
        application.then(
          (workers) => workers.stop(),
          () => {}, // Failed startup has no application handle to release.
        ),
      ]);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(errors, "Worker shutdown failed");
    })();
    return stopping;
  };
  registerShutdownHook("worker.runtime", "workers", stop);

  try {
    await Promise.all([general.start(), application]);
    return { stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Worker startup and rollback failed",
      );
    }
    throw error;
  }
}
