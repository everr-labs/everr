import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db/client";
import { startWorkerRuntime } from "@/server/worker/runtime";
import { captureError, getTelemetryTracer, SpanKind } from "@/telemetry/node";
import { instrumentServerFetch } from "@/telemetry/server";

const startupTracer = getTelemetryTracer("everr-app.startup");

await startupTracer.startActiveSpan(
  "startup.database_migration",
  { kind: SpanKind.INTERNAL },
  async (span) => {
    try {
      await migrate(db, { migrationsFolder: "./drizzle" });
    } catch (error) {
      captureError(error, {
        "everr.error.source": "startup.database_migration",
      });
      throw error;
    } finally {
      span.end();
    }
  },
);

void startWorkerRuntime().catch((error) => {
  captureError(error, {
    "everr.error.source": "startup.worker_runtime",
  });
});

const handler = defineHandlerCallback((ctx) => {
  return defaultStreamHandler(ctx);
});

const startFetch = createStartHandler(handler);

export default {
  fetch: (...args: Parameters<typeof startFetch>) =>
    instrumentServerFetch(args[0], () => startFetch(...args)),
};
