import { events as appEvents } from "@everr/app/server/events/runtime";
import { EventEmitter } from "node:events";
import { databasePoolConfig } from "@everr/app/db/client";
import * as schema from "@everr/app/db/schema";
import { attachGraphileWorkerEventLogging } from "@everr/app/server/worker/events";
import { managedWorker } from "@everr/app/server/worker/managed-worker";
import { exceptionAttributes, serverLogger } from "@everr/app/telemetry/logger";
import { drizzle } from "drizzle-orm/node-postgres";
import { run, type WorkerEvents } from "graphile-worker";
import { Pool } from "pg";
import { attachOrganizationRetryPolicy } from "./retries";
import { createOrganizationTaskList, organizationProvisioningCronItems } from "./runtime";

export const organizationWorker = managedWorker({
  name: "everrOrganizationWorker",
  hot: import.meta.hot,
  start: async () => {
    const pool = new Pool({ ...databasePoolConfig, max: 4 });
    const database = drizzle(pool, { schema });
    const events: WorkerEvents = new EventEmitter();
    // Job boundaries record one correlated exception per attempt.
    attachGraphileWorkerEventLogging(events, false);
    const retries = attachOrganizationRetryPolicy(events, pool);
    try {
      const runner = await run({
        concurrency: 2,
        pgPool: pool,
        events,
        noHandleSignals: true,
        pollInterval: 1000,
        taskList: createOrganizationTaskList(database, retries.capPendingRetries, appEvents),
        parsedCronItems: organizationProvisioningCronItems,
        preset: { worker: { gracefulShutdownAbortTimeout: 5000 } },
      });
      let runnerStopped = false;
      runner.events.on("stop", () => {
        runnerStopped = true;
      });
      // Observe runner failures immediately. Recovery runs independently so a
      // slow Postgres query cannot leave runner.promise unhandled.
      const recovery = retries.capPendingRetries().catch((error) => {
        serverLogger.error(
          "clickhouse.organization.retry_recovery.failed",
          exceptionAttributes(error),
        );
      });
      return {
        promise: runner.promise,
        stop: async () => {
          try {
            if (!runnerStopped) await runner.stop();
          } finally {
            await recovery;
            await retries.drain();
            await pool.end();
          }
        },
      };
    } catch (error) {
      await pool.end();
      throw error;
    }
  },
});
