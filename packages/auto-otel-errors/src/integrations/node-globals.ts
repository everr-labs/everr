import { diag } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { PKG_NAME } from "../client.js";
import type { Integration } from "../types.js";

const FLUSH_TIMEOUT_MS = 2000;

type FatalEventName = "uncaughtException" | "unhandledRejection";

export function nodeGlobalHandlersIntegration(): Integration {
  let teardownFns: Array<() => void> = [];

  return {
    name: "nodeGlobalHandlers",
    setup(client) {
      const install = (
        eventName: FatalEventName,
        mechanism: "uncaughtException" | "unhandledrejection",
      ) => {
        const handler = (...args: unknown[]) => {
          const [reason] = args;
          client.capture({
            error: reason,
            mechanism,
            handled: false,
            severity: "fatal",
          });

          void flushLogs().finally(() => {
            if (client.options.onFatal === "continue") {
              return;
            }

            const others = process
              .listeners(eventName)
              .filter((listener) => listener !== (handler as unknown));
            if (others.length === 0) {
              process.exit(1);
            }
          });
        };

        process.on(eventName, handler);
        teardownFns.push(() => process.off(eventName, handler));
      };

      install("uncaughtException", "uncaughtException");
      install("unhandledRejection", "unhandledrejection");
    },
    teardown() {
      for (const fn of teardownFns) {
        fn();
      }
      teardownFns = [];
    },
  };
}

async function flushLogs(): Promise<void> {
  const provider = logs.getLoggerProvider() as {
    forceFlush?: () => Promise<void>;
  };

  if (typeof provider.forceFlush !== "function") {
    return;
  }

  await Promise.race([
    provider
      .forceFlush()
      .catch((err) => diag.error(`${PKG_NAME}: flush on fatal failed`, err)),
    new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
  ]);
}
