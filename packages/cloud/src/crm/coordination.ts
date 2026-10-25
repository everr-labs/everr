import { createHash } from "node:crypto";
import type { JobHelpers, Task, TaskSpec } from "graphile-worker";
import type { Pool } from "pg";
import type { z } from "zod";
import { syncDiagnostic, type SyncDiagnostic } from "./telemetry";
import type { UserSyncPayload, OrganizationSyncPayload, MembershipSyncPayload } from "./commands";

export class RetainedCrmWork extends Error {}

/** Internal execution seam. Only the coordinated Graphile entry accepts raw persisted data. */
export type CrmTask<Payload> = (payload: Payload, helpers: JobHelpers) => Promise<void>;

/** Session locks cover whole HTTP executions, without a source transaction or lock waits.
 * Association tasks take both endpoint locks in stable order. Parent tasks take one.
 * A lost connection aborts HTTP; the provider has no fencing token, so late acceptance
 * remains possible and is recovered through persisted identity/attempt state.
 */
export function coordinateCrmTask<
  Payload extends UserSyncPayload | OrganizationSyncPayload | MembershipSyncPayload,
>(options: {
  pool: Pick<Pool, "connect">;
  deployment: string;
  schema: z.ZodType<Payload>;
  endpoints: (payload: Payload) => string[];
  task: CrmTask<Payload>;
  spec: (payload: Payload) => TaskSpec;
  invalidMessage: string;
  diagnostic?: SyncDiagnostic;
}): Task {
  const { pool, deployment, endpoints, task, spec, schema, diagnostic = syncDiagnostic } = options;
  const execute: CrmTask<Payload> = async (payload, helpers) => {
    const keys = [...new Set(endpoints(payload))].sort();
    const client = await pool.connect();
    const controller = new AbortController();
    let lost = false;
    const connectionLost = () => {
      lost = true;
      controller.abort();
    };
    client.on("error", connectionLost);
    const held: [number, number][] = [];
    try {
      for (const key of keys) {
        const hash = createHash("sha256")
          .update(JSON.stringify([deployment, key]))
          .digest();
        const lock: [number, number] = [hash.readInt32BE(0), hash.readInt32BE(4)];
        const result = await client.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
          lock,
        );
        if (!result.rows[0].acquired) {
          await helpers.addJob(helpers.job.task_identifier, payload, {
            ...spec(payload),
            runAt: new Date(Date.now() + 1000),
          });
          return;
        }
        held.push(lock);
      }
      const signal = helpers.abortSignal
        ? AbortSignal.any([helpers.abortSignal, controller.signal])
        : controller.signal;
      await task(payload, { ...helpers, abortSignal: signal });
      if (lost) throw new Error("CRM synchronization lock connection lost.");
    } finally {
      try {
        if (!lost)
          for (const lock of held.reverse())
            await client.query("SELECT pg_advisory_unlock($1::int, $2::int)", lock);
      } catch {
        lost = true;
      } finally {
        client.removeListener("error", connectionLost);
        client.release(lost);
      }
    }
  };
  return async (raw, helpers) => {
    try {
      // Zod copies the strict, scalar-only command before any asynchronous work.
      // Keep this snapshot for locks, execution, cleanup and every continuation.
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        diagnostic("invalid", undefined, String(helpers.job.id));
        throw new RetainedCrmWork(options.invalidMessage);
      }
      await execute(parsed.data, helpers);
    } catch (error) {
      if (error instanceof RetainedCrmWork) throw error;
      // eslint-disable-next-line preserve-caught-error -- Connection errors must not escape to worker logs.
      throw new Error("CRM coordination failed; persisted work remains available for retry.");
    }
  };
}
