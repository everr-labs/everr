import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { hotSingleton } from "./hot-singleton";

type WorkerHandle = { promise: Promise<void>; stop(): Promise<void> };

// Each pool owns its supervisor. Startup and runtime failures retry without
// stopping another pool, and shutdown interrupts the retry wait immediately.
export function managedWorker(options: {
  name: string;
  start(): Promise<WorkerHandle>;
  hot: Parameters<typeof hotSingleton>[0]["hot"];
  retryDelayMs?: number;
}) {
  return hotSingleton<WorkerHandle>({
    key: options.name,
    hot: options.hot,
    start: async () => {
      let stopping = false;
      let finishStop!: () => void;
      const stopped = new Promise<void>((resolve) => {
        finishStop = resolve;
      });
      const loop = (async () => {
        while (!stopping) {
          let worker: WorkerHandle | undefined;
          try {
            worker = await options.start();
            if (!stopping) await Promise.race([worker.promise, stopped]);
            if (!stopping) throw new Error("Worker stopped unexpectedly");
          } catch (error) {
            if (!stopping)
              serverLogger.error("worker.runtime.failed", {
                ...exceptionAttributes(error),
                "everr.worker.pool": options.name,
              });
          } finally {
            if (worker) {
              try {
                await worker.stop();
              } catch (error) {
                serverLogger.error("worker.runtime.stop_failed", {
                  ...exceptionAttributes(error),
                  "everr.worker.pool": options.name,
                });
              }
            }
          }
          if (!stopping) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, options.retryDelayMs ?? 5000);
              }),
              stopped,
            ]);
            clearTimeout(timer);
          }
        }
      })();
      return {
        promise: loop,
        stop: async () => {
          stopping = true;
          finishStop();
          await loop;
        },
      };
    },
    stop: (worker) => worker.stop(),
    onError: (error) =>
      serverLogger.error("worker.runtime.stop_failed", {
        ...exceptionAttributes(error),
        "everr.worker.pool": options.name,
      }),
  });
}
