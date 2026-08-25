import { createHash } from "node:crypto";
import type { TaskSpec } from "graphile-worker";
import type { Transaction } from "@/db/client";
import { addWorkerJob, addWorkerJobInTransaction } from "@/server/worker/jobs";
import { currentTraceLink } from "../trace-link";

export const ALERT_EVALUATE_TASK = "alerts/evaluate";

const EVALUATE_MAX_ATTEMPTS = 5;
const HASH_SPACE_SIZE = 2 ** 32;
const MAX_INITIAL_RETRY_SECONDS = 10;

export interface EvaluatePayload {
  alertDefinitionId: string;
  scheduledFor: string;
  ruleVersion: number;
  /** The enqueuer's span, so the evaluation can link back to what scheduled it. */
  traceparent?: string;
}

export function alertingPartitionQueue(
  kind: "alert" | "group",
  id: string,
): string {
  const partition =
    createHash("sha256").update(id).digest().readUInt16BE(0) % 64;
  return `alerts-${kind}-${partition}`;
}

export function nextAlertEvaluationAt(
  organizationId: string,
  definitionId: string,
  intervalSeconds: number,
  after = new Date(),
): Date {
  const intervalMs = intervalSeconds * 1_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(
      "alert evaluation interval must be a positive safe integer",
    );
  }
  const hash = createHash("sha256")
    .update(`alert\0${organizationId}\0${definitionId}`)
    .digest()
    .readUInt32BE(0);
  const phaseMs = Math.floor((hash / HASH_SPACE_SIZE) * intervalMs);
  const remainder =
    (((after.getTime() - phaseMs) % intervalMs) + intervalMs) % intervalMs;
  const delayMs = remainder === 0 ? intervalMs : intervalMs - remainder;
  return new Date(after.getTime() + delayMs);
}

export function alertingRetryAt(
  delaySeconds: number,
  after = new Date(),
): Date {
  const delayMs = delaySeconds * 1_000;
  if (!Number.isSafeInteger(delayMs) || delayMs <= 0) {
    throw new Error("alert retry delay must be a positive safe integer");
  }
  return new Date(after.getTime() + delayMs);
}

export function alertingRetryDelaySeconds(
  intervalSeconds: number,
  failureCount: number,
  maximumSeconds: number,
): number {
  const initial = Math.min(MAX_INITIAL_RETRY_SECONDS, intervalSeconds);
  const exponent = Math.min(30, Math.max(0, failureCount - 1));
  return Math.min(maximumSeconds, initial * 2 ** exponent);
}

export function alertEvaluationJobKey(
  id: string,
  scheduledFor: string,
): string {
  return `${ALERT_EVALUATE_TASK}:${id}:${scheduledFor}`;
}

// `runAt` is not a parameter. The payload's own `scheduledFor` is when the
// evaluation is due, and a job run at another time would evaluate a different
// instant than the one it is keyed on.
function evaluationTaskSpec(payload: EvaluatePayload): TaskSpec {
  return {
    jobKey: alertEvaluationJobKey(
      payload.alertDefinitionId,
      payload.scheduledFor,
    ),
    jobKeyMode: "replace",
    maxAttempts: EVALUATE_MAX_ATTEMPTS,
    queueName: alertingPartitionQueue("alert", payload.alertDefinitionId),
    runAt: new Date(payload.scheduledFor),
  };
}

export function enqueueAlertEvaluation(
  payload: EvaluatePayload,
): Promise<void> {
  return addWorkerJob(
    ALERT_EVALUATE_TASK,
    { ...payload, ...currentTraceLink() },
    evaluationTaskSpec(payload),
  );
}

// Enqueued through graphile's SQL function so the job commits or rolls back
// with the mutation that scheduled it.
export function enqueueAlertEvaluationInTransaction(
  tx: Transaction,
  payload: EvaluatePayload,
): Promise<void> {
  return addWorkerJobInTransaction(
    tx,
    ALERT_EVALUATE_TASK,
    { ...payload, ...currentTraceLink() },
    evaluationTaskSpec(payload),
  );
}
