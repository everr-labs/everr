import { runtime } from "@composition/runtime";

import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { withMigrationLock } from "#app/db/migrations.ts";
import { startWorkerRuntime } from "#app/server/worker/runtime.ts";
import { captureError, getTelemetryTracer, SpanKind } from "#app/telemetry/node.ts";

const { migrateDatabase, migrateClickHouse } = runtime;

const startupTracer = getTelemetryTracer("everr-app.startup");

if (process.env.TSS_PRERENDERING !== "true") {
  await startupTracer.startActiveSpan(
    "startup.database_migration",
    { kind: SpanKind.INTERNAL },
    async (span) => {
      try {
        await withMigrationLock(async (database) => {
          await migrateDatabase(database);
          await migrateClickHouse();
        });
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
