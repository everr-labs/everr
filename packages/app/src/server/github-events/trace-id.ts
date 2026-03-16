import { createHash } from "node:crypto";
import {
  type ParsedQueuedWorkflowEvent,
  parseQueuedWorkflowEvent,
  repositoryIdFromQueuedEvent,
} from "./payloads";

function normalizeRepositoryId(repositoryId: number): number {
  if (!Number.isInteger(repositoryId) || repositoryId <= 0) {
    throw new TypeError("repositoryId must be a positive integer");
  }

  return repositoryId;
}

function normalizeRunAttempt(runAttempt?: number | null): number {
  if (Number.isInteger(runAttempt) && (runAttempt ?? 0) > 0) {
    return runAttempt as number;
  }

  return 1;
}

export function generateWorkflowTraceId(
  repositoryId: number,
  runId: number,
  runAttempt?: number | null,
): string {
  const normalizedRepositoryId = normalizeRepositoryId(repositoryId);
  if (!Number.isInteger(runId)) {
    throw new TypeError("runId must be an integer");
  }

  return createHash("sha256")
    .update(
      `${normalizedRepositoryId}@${runId}#${normalizeRunAttempt(runAttempt)}`,
    )
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
