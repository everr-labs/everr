import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { enqueueAlertEvaluation } from "@/data/alerting/scheduling/evaluation-jobs.server";
import { db } from "@/db/client";
import { alertDefinitions } from "@/db/schema";
import { env } from "@/env";

const SCANNER_BATCH_SIZE = 5_000;
const ENQUEUE_CONCURRENCY = 8;

/**
 * How long an enqueued-but-unevaluated definition waits before the scanner
 * picks it up again.
 *
 * `lastEnqueuedAt >= nextEvaluationAt` normally means "a job is in flight",
 * which is why the scanner skips it. Nothing clears that on its own, so any
 * terminal failure that does not reschedule leaves the rule silent for good:
 * a worker killed mid-evaluation, a job dropped from the queue, or a throw on
 * a path that forgot to advance scheduling state.
 *
 * Re-enqueueing is safe because both the job key and the `alert_evaluations`
 * insert are keyed on `scheduledFor`, so a duplicate collapses. Keep this well
 * above the slowest legitimate evaluation.
 */
const STALE_ENQUEUE_SECONDS = 15 * 60;

export function staleEnqueueCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_ENQUEUE_SECONDS * 1_000);
}

/**
 * `EVERR_PREVIEW_ALERTS=off` is the documented kill switch for preview
 * evaluation load. Decided as a pure function of the raw setting so it is
 * testable without a database, the same way `staleEnqueueCutoff` is.
 */
export function previewDefinitionsEnqueueable(
  previewAlertsSetting: "on" | "off",
): boolean {
  return previewAlertsSetting === "on";
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
  const includePreviewDefinitions = previewDefinitionsEnqueueable(
    env.EVERR_PREVIEW_ALERTS,
  );
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
          lt(alertDefinitions.lastEnqueuedAt, staleEnqueueCutoff(now)),
        ),
        includePreviewDefinitions
          ? undefined
          : isNull(alertDefinitions.previewId),
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
