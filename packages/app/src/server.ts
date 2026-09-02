import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db/client";
import { seedDefaultRetention } from "@/lib/clickhouse";
import { startWorkerRuntime } from "@/server/worker/runtime";
import { captureError, getTelemetryTracer, SpanKind } from "@/telemetry/node";

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

// Non-fatal: the ClickHouse init seeds the same row on a fresh cluster, and an
// existing cluster keeps its last value, so a failure here only delays a
// free-tier change until the next start.
void startupTracer.startActiveSpan(
  "startup.retention_default",
  { kind: SpanKind.INTERNAL },
  async (span) => {
    try {
      await seedDefaultRetention();
    } catch (error) {
      captureError(error, {
        "everr.error.source": "startup.retention_default",
      });
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
  fetch: startFetch,
};
