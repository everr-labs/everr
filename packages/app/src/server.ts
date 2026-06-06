import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db/client";
import { alertEnv } from "@/env/alerts";
import { startAlertRuntime } from "@/server/alerts/runtime";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import {
  getTelemetryTracer,
  recordTelemetryError,
  SpanKind,
} from "@/telemetry/node";
import { instrumentServerFetch } from "@/telemetry/server";

const startupTracer = getTelemetryTracer("everr-app.startup");

await startupTracer.startActiveSpan(
  "startup.database_migration",
  { kind: SpanKind.INTERNAL },
  async (span) => {
    try {
      await migrate(db, { migrationsFolder: "./drizzle" });
    } catch (error) {
      recordTelemetryError(error, {
        "error.handled": false,
        "error.source": "startup.database_migration",
      });
      throw error;
    } finally {
      span.end();
    }
  },
);

if (alertEnv.EVERR_ALERTS_ENABLED) {
  await startupTracer.startActiveSpan(
    "startup.alert_runtime",
    { kind: SpanKind.INTERNAL },
    async (span) => {
      try {
        await startAlertRuntime();
      } catch (error) {
        serverLogger.error(
          "alerts.runtime.start_failed",
          exceptionAttributes(error),
        );
        recordTelemetryError(error, {
          "error.handled": false,
          "error.source": "startup.alert_runtime",
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

const handler = defineHandlerCallback((ctx) => {
  return defaultStreamHandler(ctx);
});

const startFetch = createStartHandler(handler);

export default {
  fetch: (...args: Parameters<typeof startFetch>) =>
    instrumentServerFetch(args[0], () => startFetch(...args)),
};
