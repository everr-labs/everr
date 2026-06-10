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
    for (const alert of claimed) {
      await enqueueEvaluationJob(tx, alert);
    }
    return claimed.length;
  });
}

async function enqueueEvaluationJob(tx: TransactionLike, alert: ClaimedAlert) {
  const scheduledFor = isoTimestamp(alert.evaluation_scheduled_at);
  const payload: EvaluatePayload = {
    alertDefinitionId: alert.id,
    scheduledFor,
  };
  const jobKey = `${ALERT_EVALUATE_TASK}:${alert.id}:${scheduledFor}`;
  const queueName = `alerts:eval:${alert.organization_id}`;

  await tx.execute(sql`
    SELECT *
    FROM graphile_worker.add_job(
      identifier => ${ALERT_EVALUATE_TASK}::text,
      payload => ${JSON.stringify(payload)}::json,
      queue_name => ${queueName}::text,
      run_at => NULL::timestamptz,
      max_attempts => 3::int,
      job_key => ${jobKey}::text,
      priority => NULL::int,
      flags => NULL::text[],
      job_key_mode => 'replace'::text
    )
  `);
}

function isoTimestamp(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
