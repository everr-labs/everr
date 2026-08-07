import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import { alertDefinitions, sloDefinitions } from "@/db/schema";
import { addWorkerJob } from "@/server/worker/jobs";

export const ALERT_EVALUATE_TASK = "alerts/evaluate";
export const SLO_EVALUATE_TASK = "alerts/evaluate-slo";

const SCANNER_BATCH_SIZE = 5_000;
const EVALUATE_MAX_ATTEMPTS = 5;
const ENQUEUE_CONCURRENCY = 8;
const HASH_SPACE_SIZE = 2 ** 32;
const MAX_INITIAL_RETRY_SECONDS = 10;

export const SLO_EVALUATION_INTERVAL_SECONDS = 60;

export interface EvaluatePayload {
  alertDefinitionId: string;
  scheduledFor: string;
  ruleVersion: number;
}

export interface EvaluateSloPayload {
  sloDefinitionId: string;
  scheduledFor: string;
  sloVersion: number;
}

export function alertingPartitionQueue(
  kind: "alert" | "group" | "slo",
  id: string,
): string {
  const partition =
    createHash("sha256").update(id).digest().readUInt16BE(0) % 64;
  return `alerts-${kind}-${partition}`;
}

function nextAlertingEvaluationAt(
  kind: "alert" | "slo",
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
    .update(`${kind}\0${organizationId}\0${definitionId}`)
    .digest()
    .readUInt32BE(0);
  const phaseMs = Math.floor((hash / HASH_SPACE_SIZE) * intervalMs);
  const remainder =
    (((after.getTime() - phaseMs) % intervalMs) + intervalMs) % intervalMs;
  const delayMs = remainder === 0 ? intervalMs : intervalMs - remainder;
  return new Date(after.getTime() + delayMs);
}

export function nextAlertEvaluationAt(
  organizationId: string,
  definitionId: string,
  intervalSeconds: number,
  after?: Date,
): Date {
  return nextAlertingEvaluationAt(
    "alert",
    organizationId,
    definitionId,
    intervalSeconds,
    after,
  );
}

export function nextSloEvaluationAt(
  organizationId: string,
  definitionId: string,
  after?: Date,
): Date {
  return nextAlertingEvaluationAt(
    "slo",
    organizationId,
    definitionId,
    SLO_EVALUATION_INTERVAL_SECONDS,
    after,
  );
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

export function sloEvaluationJobKey(id: string, scheduledFor: string): string {
  return `${SLO_EVALUATE_TASK}:${id}:${scheduledFor}`;
}

export function enqueueAlertEvaluation(
  payload: EvaluatePayload,
  runAt = new Date(payload.scheduledFor),
): Promise<void> {
  return addWorkerJob(ALERT_EVALUATE_TASK, payload, {
    jobKey: alertEvaluationJobKey(
      payload.alertDefinitionId,
      payload.scheduledFor,
    ),
    jobKeyMode: "replace",
    maxAttempts: EVALUATE_MAX_ATTEMPTS,
    queueName: alertingPartitionQueue("alert", payload.alertDefinitionId),
    runAt,
  });
}

export function enqueueSloEvaluation(
  payload: EvaluateSloPayload,
  runAt = new Date(payload.scheduledFor),
): Promise<void> {
  return addWorkerJob(SLO_EVALUATE_TASK, payload, {
    jobKey: sloEvaluationJobKey(payload.sloDefinitionId, payload.scheduledFor),
    jobKeyMode: "replace",
    maxAttempts: EVALUATE_MAX_ATTEMPTS,
    queueName: alertingPartitionQueue("slo", payload.sloDefinitionId),
    runAt,
  });
}

async function boundedEnqueue<T>(
  items: readonly T[],
  enqueue: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += ENQUEUE_CONCURRENCY) {
    await Promise.all(
      items.slice(index, index + ENQUEUE_CONCURRENCY).map(enqueue),
    );
  }
}

export async function scanDueAlerts(
  opts: { batchSize?: number; now?: Date } = {},
): Promise<number> {
  const batchSize = opts.batchSize ?? SCANNER_BATCH_SIZE;
  const now = opts.now ?? new Date();
  const rows = await db
    .select({
      id: alertDefinitions.id,
      scheduledFor: alertDefinitions.nextEvaluationAt,
      version: alertDefinitions.version,
    })
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.active, true),
        lte(alertDefinitions.nextEvaluationAt, now),
        or(
          isNull(alertDefinitions.lastEnqueuedAt),
          lt(
            alertDefinitions.lastEnqueuedAt,
            alertDefinitions.nextEvaluationAt,
          ),
        ),
      ),
    )
    .orderBy(asc(alertDefinitions.nextEvaluationAt))
    .limit(batchSize);

  await boundedEnqueue(rows, (row) =>
    enqueueAlertEvaluation({
      alertDefinitionId: row.id,
      scheduledFor: row.scheduledFor?.toISOString() ?? now.toISOString(),
      ruleVersion: row.version,
    }),
  );
  if (rows.length > 0) {
    await db
      .update(alertDefinitions)
      .set({ lastEnqueuedAt: now })
      .where(
        inArray(
          alertDefinitions.id,
          rows.map((row) => row.id),
        ),
      );
  }
  return rows.length;
}

export async function scanDueSlos(
  opts: { batchSize?: number; now?: Date } = {},
): Promise<number> {
  const batchSize = opts.batchSize ?? SCANNER_BATCH_SIZE;
  const now = opts.now ?? new Date();
  const rows = await db
    .select({
      id: sloDefinitions.id,
      scheduledFor: sloDefinitions.nextEvaluationAt,
      version: sloDefinitions.version,
    })
    .from(sloDefinitions)
    .where(
      and(
        eq(sloDefinitions.paused, false),
        lte(sloDefinitions.nextEvaluationAt, now),
        or(
          isNull(sloDefinitions.lastEnqueuedAt),
          lt(sloDefinitions.lastEnqueuedAt, sloDefinitions.nextEvaluationAt),
        ),
      ),
    )
    .orderBy(asc(sloDefinitions.nextEvaluationAt))
    .limit(batchSize);

  await boundedEnqueue(rows, (row) =>
    enqueueSloEvaluation({
      sloDefinitionId: row.id,
      scheduledFor: row.scheduledFor.toISOString(),
      sloVersion: row.version,
    }),
  );
  if (rows.length > 0) {
    await db
      .update(sloDefinitions)
      .set({ lastEnqueuedAt: now })
      .where(
        inArray(
          sloDefinitions.id,
          rows.map((row) => row.id),
        ),
      );
  }
  return rows.length;
}
