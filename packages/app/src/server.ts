import { server } from "@composition/server";

import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { withMigrationLock } from "@/db/migrations";
import { startWorkerRuntime } from "@/server/worker/runtime";
import { captureError, getTelemetryTracer, SpanKind } from "@/telemetry/node";

const { migrateDatabase } = server;

const startupTracer = getTelemetryTracer("everr-app.startup");

if (process.env.TSS_PRERENDERING !== "true") {
  await startupTracer.startActiveSpan(
    "startup.database_migration",
    { kind: SpanKind.INTERNAL },
    async (span) => {
      try {
        await withMigrationLock(migrateDatabase);
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
}

const handler = defineHandlerCallback((ctx) => {
  return defaultStreamHandler(ctx);
});

const startFetch = createStartHandler(handler);

export default {
  fetch: startFetch,
};
