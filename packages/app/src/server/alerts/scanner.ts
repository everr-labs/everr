import { type SQLWrapper, sql } from "drizzle-orm";
import { db } from "@/db/client";

export const ALERT_EVALUATE_TASK = "alerts/evaluate";
const SCANNER_BATCH_SIZE = 500;

export interface EvaluatePayload {
  alertDefinitionId: string;
  scheduledFor: string;
}

interface ClaimedAlert extends Record<string, unknown> {
  id: string;
  organization_id: string;
  evaluation_scheduled_at: Date | string;
}

type TransactionLike = {
  execute: (query: string | SQLWrapper) => Promise<unknown> | unknown;
};

export async function scanDueAlerts(opts: { batchSize?: number } = {}) {
  const batchSize = opts.batchSize ?? SCANNER_BATCH_SIZE;

  return db.transaction(async (tx) => {
    const claimedResult = await tx.execute<ClaimedAlert>(sql`
      WITH claim AS (
        SELECT now() AS claimed_at
      ),
      due AS (
        SELECT id, next_evaluation_at
        FROM alert_definitions
        WHERE active AND next_evaluation_at <= now()
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

    const claimed = claimedResult.rows;
    if (claimed.length > 0) {
      await enqueueEvaluationJobs(tx, claimed);
    }
    return claimed.length;
  });
}

// One statement for the whole batch instead of one add_job round trip per
// claimed alert — the transaction holds the claimed row locks until commit, so
// enqueue latency directly extends lock hold time.
async function enqueueEvaluationJobs(
  tx: TransactionLike,
  alerts: ClaimedAlert[],
) {
  const payloads: string[] = [];
  const queueNames: string[] = [];
  const jobKeys: string[] = [];
  for (const alert of alerts) {
    const scheduledFor = isoTimestamp(alert.evaluation_scheduled_at);
    const payload: EvaluatePayload = {
      alertDefinitionId: alert.id,
      scheduledFor,
    };
    payloads.push(JSON.stringify(payload));
    queueNames.push(`alerts:eval:${alert.organization_id}`);
    jobKeys.push(`${ALERT_EVALUATE_TASK}:${alert.id}:${scheduledFor}`);
  }

  await tx.execute(sql`
    SELECT graphile_worker.add_job(
      identifier => ${ALERT_EVALUATE_TASK}::text,
      payload => job.payload::json,
      queue_name => job.queue_name,
      run_at => NULL::timestamptz,
      max_attempts => 3::int,
      job_key => job.job_key,
      priority => NULL::int,
      flags => NULL::text[],
      job_key_mode => 'replace'::text
    )
    FROM unnest(
      ${payloads}::text[],
      ${queueNames}::text[],
      ${jobKeys}::text[]
    ) AS job(payload, queue_name, job_key)
  `);
}

function isoTimestamp(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
