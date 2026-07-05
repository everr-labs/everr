import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { env } from "@/env";
import { addWorkerJob } from "@/server/worker/jobs";

export const ALERT_EVALUATE_TASK = "alerts/evaluate";
const SCANNER_BATCH_SIZE = 500;
const EVALUATE_MAX_ATTEMPTS = 3;
const ENQUEUE_CONCURRENCY = 5;
// The scan cron fires once a minute, a few tens of ms after the boundary, so a
// reschedule of `claimed_at + interval` lands just past the next boundary and
// the following tick sees the alert as not-yet-due, skipping a minute. Claiming
// anything due within this grace window absorbs that jitter; the reschedule
// (still claimed_at + interval) keeps the phase from drifting earlier.
const SCAN_GRACE_SECONDS = 5;

export interface EvaluatePayload {
  alertDefinitionId: string;
  scheduledFor: string;
}

interface ClaimedAlert extends Record<string, unknown> {
  id: string;
  organization_id: string;
  evaluation_scheduled_at: Date | string;
}

export async function scanDueAlerts(opts: { batchSize?: number } = {}) {
  const batchSize = opts.batchSize ?? SCANNER_BATCH_SIZE;

  const { rows: claimed } = await db.execute<ClaimedAlert>(sql`
    WITH claim AS (
      SELECT now() AS claimed_at
    ),
    due AS (
      SELECT id, next_evaluation_at
      FROM alert_definitions
      WHERE active
        AND next_evaluation_at <= now() + make_interval(secs => ${SCAN_GRACE_SECONDS})
        ${env.EVERR_PREVIEW_ALERTS === "off" ? sql`AND preview_id IS NULL` : sql``}
      ORDER BY next_evaluation_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE alert_definitions d
    SET
      next_evaluation_at = claim.claimed_at + make_interval(secs => d.evaluation_interval_seconds),
      last_enqueued_at = claim.claimed_at
    FROM due, claim
    WHERE d.id = due.id
    RETURNING d.id, d.organization_id, claim.claimed_at AS evaluation_scheduled_at
  `);

  // Enqueue after the claim commits, through graphile-worker's public API
  // (deliberately not atomic with the claim). A crash between commit and
  // enqueue skips one evaluation cycle; the alert is simply claimed again at
  // its next interval. job_key replace semantics keep the enqueue idempotent.
  //
  // Chunked rather than one flat Promise.all: a full 500-alert batch would
  // otherwise queue 500 checkouts at once on the shared pg pool (default max
  // 10) and starve every other consumer while it drains.
  for (let i = 0; i < claimed.length; i += ENQUEUE_CONCURRENCY) {
    await Promise.all(
      claimed.slice(i, i + ENQUEUE_CONCURRENCY).map((alert) => {
        const scheduledFor = isoTimestamp(alert.evaluation_scheduled_at);
        const payload: EvaluatePayload = {
          alertDefinitionId: alert.id,
          scheduledFor,
        };
        return addWorkerJob(ALERT_EVALUATE_TASK, payload, {
          jobKey: `${ALERT_EVALUATE_TASK}:${alert.id}:${scheduledFor}`,
          jobKeyMode: "replace",
          maxAttempts: EVALUATE_MAX_ATTEMPTS,
          queueName: `alerts:eval:${alert.organization_id}`,
        });
      }),
    );
  }

  return claimed.length;
}

function isoTimestamp(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
