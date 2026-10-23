import { runtime } from "@composition/runtime";
import type { ApplicationWorker } from "#app/composition/runtime.ts";
import { registerShutdownHook } from "#app/server/shutdown.ts";
import { productWorker } from "./product-worker";

function throwFailures(results: PromiseSettledResult<unknown>[], message: string) {
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, message);
}

export async function startWorkerRuntime() {
  const workers: ApplicationWorker[] = [productWorker];
  const starting = (async () => {
    workers.push(...(await runtime.registerWorkers()));
    const results = await Promise.allSettled(workers.map(async (worker) => worker.start()));
    throwFailures(results, "Worker startup failed");
  })();
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      // Drain registration and startup before releasing all workers, including
      // those whose start failed. The caller retains any startup error.
      await starting.catch(() => {});
      const results = await Promise.allSettled(workers.map(async (worker) => worker.stop()));
      throwFailures(results, "Worker shutdown failed");
    })();
    return stopping;
  };
  registerShutdownHook("worker.runtime", "workers", stop);

  try {
    await starting;
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
