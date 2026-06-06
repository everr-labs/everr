import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

export type WorkflowNotifyPayload = {
  kind: "workflow";
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

export type AlertNotifyPayload = {
  kind: "alert";
  tenantId: string;
  recipientUserIds: string[];
  alertDefinitionId: number;
  alertEventId: number;
  service: string;
  name: string;
  severity: "critical" | "warning";
  status: "firing" | "resolved" | "evaluation_failed";
  summary: string;
  description: string | null;
  occurredAt: string;
  sourceUrl: string;
  rowCount: number;
};

export type NotifyPayload = WorkflowNotifyPayload | AlertNotifyPayload;

type WorkflowNotifyInput = Omit<WorkflowNotifyPayload, "kind"> & {
  kind?: "workflow";
};

export async function notifyWorkflowUpdate(
  db: NodePgDatabase<Record<string, never>>,
  payload: WorkflowNotifyInput,
): Promise<void> {
  await notifyWorkflows(db, { ...payload, kind: "workflow" });
}

export async function notifyAlertUpdate(
  db: NodePgDatabase<Record<string, never>>,
  payload: AlertNotifyPayload,
): Promise<void> {
  await notifyWorkflows(db, payload);
}

async function notifyWorkflows(
  db: NodePgDatabase<Record<string, never>>,
  payload: NotifyPayload,
): Promise<void> {
  try {
    const payloadJson = JSON.stringify(payload);
    await db.execute(sql`SELECT pg_notify('workflows', ${payloadJson})`);
  } catch (err) {
    serverLogger.error("postgres.notify.failed", {
      ...exceptionAttributes(err),
      "messaging.destination.name": "workflows",
      "messaging.system": "postgresql",
    });
  }
}
