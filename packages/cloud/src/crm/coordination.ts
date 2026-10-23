import { createHash } from "node:crypto";
import type { Task, TaskSpec } from "graphile-worker";
import type { Pool } from "pg";
import { RetainedCrmWork } from "./user-sync";

/** Session locks cover whole HTTP executions, without a source transaction or lock waits.
 * Association tasks take both endpoint locks in stable order. Parent tasks take one.
 * A lost connection aborts HTTP; the provider has no fencing token, so late acceptance
 * remains possible and is recovered through persisted identity/attempt state.
 */
export function coordinateCrmTask(
  pool: Pick<Pool, "connect">,
  deployment: string,
  endpoints: (raw: unknown) => string[],
  task: Task,
  spec: (raw: unknown) => TaskSpec,
): Task {
  const execute: Task = async (raw, helpers) => {
    const keys = [...new Set(endpoints(raw))].sort();
    if (!keys.length) return task(raw, helpers); // Let the handler retain invalid payloads.
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
          await helpers.addJob(helpers.job.task_identifier, raw, {
            ...spec(raw),
            runAt: new Date(Date.now() + 1000),
          });
          return;
        }
        held.push(lock);
      }
      const signal = helpers.abortSignal
        ? AbortSignal.any([helpers.abortSignal, controller.signal])
        : controller.signal;
      await task(raw, { ...helpers, abortSignal: signal });
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
      await execute(raw, helpers);
    } catch (error) {
      if (error instanceof RetainedCrmWork) throw error;
      // eslint-disable-next-line preserve-caught-error -- Connection errors must not escape to worker logs.
      throw new Error("CRM coordination failed; persisted work remains available for retry.");
    }
  };
}
