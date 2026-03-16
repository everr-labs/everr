import { createHash } from "node:crypto";
import {
  type ParsedQueuedWorkflowEvent,
  parseQueuedWorkflowEvent,
  repositoryIdFromQueuedEvent,
} from "./payloads";

export function generateWorkflowTraceId(
  repositoryId: number,
  runId: number,
  runAttempt?: number | null,
): string {
  const normalizedAttempt =
    Number.isInteger(runAttempt) && (runAttempt ?? 0) > 0
      ? (runAttempt as number)
      : 1;

  return createHash("sha256")
    .update(`${repositoryId}@${runId}#${normalizedAttempt}`)
    .digest("hex")
    .slice(0, 32);
}

export function traceIdFromQueuedWorkflowEvent(
  event: ParsedQueuedWorkflowEvent,
): string | null {
  const repositoryId = repositoryIdFromQueuedEvent(event);
  if (!repositoryId) {
    return null;
  }

  if (event.eventType === "workflow_run") {
    const workflowRun = event.payload.workflow_run;
    if (!workflowRun) {
      return null;
    }

    return generateWorkflowTraceId(
      repositoryId,
      workflowRun.id,
      workflowRun.run_attempt,
    );
  }

  const workflowJob = event.payload.workflow_job;
  if (!workflowJob) {
    return null;
  }

  return generateWorkflowTraceId(
    repositoryId,
    workflowJob.run_id,
    workflowJob.run_attempt,
  );
}

export function traceIdFromWebhookEvent(
  eventType: string,
  body: Buffer,
): string | null {
  try {
    return traceIdFromQueuedWorkflowEvent(
      parseQueuedWorkflowEvent(eventType, body),
    );
  } catch {
    return null;
  }
}
