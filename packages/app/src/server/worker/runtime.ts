import { runtime } from "@composition/runtime";
import type { ApplicationWorker } from "#app/composition/runtime.ts";
import { registerShutdownHook } from "#app/server/shutdown.ts";
import { productWorker } from "./product-worker";

function throwFailures(results: PromiseSettledResult<unknown>[], message: string) {
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, message);
}

export async function startWorkerRuntime() {
  let applicationWorkers: readonly ApplicationWorker[] = [];
  const application = Promise.resolve().then(async () => {
    applicationWorkers = await runtime.registerWorkers();
    const results = await Promise.allSettled(
      applicationWorkers.map((worker) => Promise.resolve().then(() => worker.start())),
    );
    throwFailures(results, "Application worker startup failed");
  });
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      const results = await Promise.allSettled([
        productWorker.stop(),
        application
          .catch(() => {})
          .then(async () => {
            // Also release registrations whose startup failed, and drain every
            // successful sibling before reporting any shutdown failure.
            const stopped = await Promise.allSettled(
              applicationWorkers.map((worker) => Promise.resolve().then(() => worker.stop())),
            );
            throwFailures(stopped, "Application worker shutdown failed");
          }),
      ]);
      throwFailures(results, "Worker shutdown failed");
    })();
    return stopping;
  };
  registerShutdownHook("worker.runtime", "workers", stop);

  try {
    await Promise.all([productWorker.start(), application]);
    return { stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      // oxlint-disable-next-line preserve-caught-error -- AggregateError.errors retains both the startup and cleanup errors.
      throw new AggregateError([error, cleanupError], "Worker startup and rollback failed");
    }
    throw error;
  }
}
