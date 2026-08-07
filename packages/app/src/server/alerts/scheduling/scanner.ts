import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import {
  enqueueAlertEvaluation,
  enqueueSloEvaluation,
} from "@/data/alerting/scheduling/evaluation-jobs.server";
import { db } from "@/db/client";
import { alertDefinitions, sloDefinitions } from "@/db/schema";

const SCANNER_BATCH_SIZE = 5_000;
const ENQUEUE_CONCURRENCY = 8;

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
