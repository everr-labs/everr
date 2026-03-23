import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type NotifyPayload = {
  tenantId: number;
  traceId: string;
  runId: string;
  sha: string;
};

export const SAFE_CHANNEL_RE = /^[a-zA-Z0-9_]+$/;

function assertSafeChannel(value: string): string {
  if (!SAFE_CHANNEL_RE.test(value)) {
    throw new Error(`Unsafe channel name component: ${value}`);
  }
  return value;
}

export function tenantChannel(tenantId: number): string {
  return `tenant_${tenantId}`;
}

export function traceChannel(traceId: string): string {
  assertSafeChannel(traceId);
  return `trace_${traceId}`;
}

export function commitChannel(tenantId: number, sha: string): string {
  assertSafeChannel(sha);
  return `commit_${tenantId}_${sha.toLowerCase()}`;
}

export async function notifyWorkflowUpdate(
  db: NodePgDatabase<Record<string, never>>,
  payload: NotifyPayload,
): Promise<void> {
  try {
    const payloadJson = JSON.stringify(payload);
    const tenant = tenantChannel(payload.tenantId);
    const trace = traceChannel(payload.traceId);
    const commit = commitChannel(payload.tenantId, payload.sha);

    await db.execute(
      sql`SELECT pg_notify(${tenant}, ${payloadJson}), pg_notify(${trace}, ${payloadJson}), pg_notify(${commit}, ${payloadJson})`,
    );
  } catch (err) {
    console.error("[notify] pg_notify failed", err);
  }
}
