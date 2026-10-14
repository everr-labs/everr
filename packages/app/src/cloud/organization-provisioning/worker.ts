import { EventEmitter } from "node:events";
import { drizzle } from "drizzle-orm/node-postgres";
import { run, type WorkerEvents } from "graphile-worker";
import { Pool } from "pg";
import { databasePoolConfig } from "@/db/client";
import * as schema from "@/db/schema";
import { attachGraphileWorkerEventLogging } from "@/server/worker/events";
import { managedWorker } from "@/server/worker/managed-worker";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { attachOrganizationRetryPolicy } from "./retries";
import {
  createOrganizationTaskList,
  organizationProvisioningCronItems,
} from "./runtime";

const runtime = managedWorker({
  name: "everrOrganizationWorker",
  hot: import.meta.hot,
  start: async () => {
    const pool = new Pool({ ...databasePoolConfig, max: 4 });
    const database = drizzle(pool, { schema });
    const events = new EventEmitter() as WorkerEvents;
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
        taskList: createOrganizationTaskList(
          database,
          retries.capPendingRetries,
        ),
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

export const startOrganizationWorker = () => runtime.start();
export const stopOrganizationWorker = () => runtime.stop();
