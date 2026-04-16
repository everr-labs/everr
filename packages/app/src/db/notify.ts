import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type NotifyPayload = {
  tenantId: string;
  traceId: string;
  runId: string;
  sha: string;
  repo: string;
  branch: string;
  authorEmail: string | null;
  workflowName: string;
  name: string;
  type: "run" | "job";
  status: string;
  conclusion: string | null;
  jobId: number | null;
};

export async function notifyWorkflowUpdate(
  db: NodePgDatabase<Record<string, never>>,
  payload: NotifyPayload,
): Promise<void> {
  try {
    const payloadJson = JSON.stringify(payload);
    await db.execute(sql`SELECT pg_notify('workflows', ${payloadJson})`);
  } catch (err) {
    console.error("[notify] pg_notify failed", err);
  }
}
