import { sql } from "drizzle-orm";
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "@/data/alerting/delivery/config";
import { db } from "@/db/client";

const DAY_MS = 24 * 60 * 60 * 1_000;
const EVALUATION_RETENTION_DAYS = 7;
const HISTORY_RETENTION_DAYS = 90;
const IDLE_GROUP_RETENTION_DAYS = 7;
// Inactive instance rows carry no history a reader still needs: the journal
// (alert_events) is the durable record of what happened to an instance.
const INSTANCE_RETENTION_DAYS = 7;
const CLEANUP_BATCH_SIZE = 1_000;
// A backlog outgrows a fixed batch count long before it outgrows a time
// budget: at 100 rules on a 1-minute interval, alert_evaluations alone
// accumulates ~144k rows/day, far past what MAX_BATCHES_PER_RUN=10 could
// ever drain in one run. Loop on wall clock instead, bounded well inside the
// hourly cron cadence so a run never overlaps the next one.
const CLEANUP_BUDGET_MS = 5 * 60 * 1_000;

type AlertingCleanupCounts = {
  alertEvaluations: number;
  events: number;
  deliveries: number;
  notificationGroups: number;
  silences: number;
  instances: number;
};

const EMPTY_COUNTS: AlertingCleanupCounts = {
  alertEvaluations: 0,
  events: 0,
  deliveries: 0,
  notificationGroups: 0,
  silences: 0,
  instances: 0,
};

// Keyed rather than field by field, so a seventh table added to the counts is
// summed without a second edit here.
function addCounts(
  total: AlertingCleanupCounts,
  batch: AlertingCleanupCounts,
): AlertingCleanupCounts {
  const summed = { ...total };
  for (const key of Object.keys(summed) as (keyof AlertingCleanupCounts)[]) {
    summed[key] = total[key] + batch[key];
  }
  return summed;
}

function deletedRows(result: { rowCount?: number | null }): number {
  return result.rowCount ?? 0;
}

export async function cleanupAlertingHistory(options?: {
  now?: Date;
  batchSize?: number;
  budgetMs?: number;
  /** Wall clock for the budget loop, separate from `now`'s cutoff math. */
  clock?: () => number;
}): Promise<AlertingCleanupCounts> {
  const now = options?.now ?? new Date();
  const batchSize = options?.batchSize ?? CLEANUP_BATCH_SIZE;
  const budgetMs = options?.budgetMs ?? CLEANUP_BUDGET_MS;
  const clock = options?.clock ?? Date.now;
  const deadline = clock() + budgetMs;
  const evaluationCutoff = new Date(
    now.getTime() - EVALUATION_RETENTION_DAYS * DAY_MS,
  );
  const historyCutoff = new Date(
    now.getTime() - HISTORY_RETENTION_DAYS * DAY_MS,
  );
  const idleGroupCutoff = new Date(
    now.getTime() - IDLE_GROUP_RETENTION_DAYS * DAY_MS,
  );
  const instanceCutoff = new Date(
    now.getTime() - INSTANCE_RETENTION_DAYS * DAY_MS,
  );
  let totals = { ...EMPTY_COUNTS };

  for (;;) {
    const counts = await db.transaction(async (tx) => {
      const alertEvaluations = await tx.execute(sql`
        WITH doomed AS (
          SELECT ctid
          FROM alert_evaluations
          WHERE scheduled_for < ${evaluationCutoff}
          ORDER BY scheduled_for
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM alert_evaluations AS target
        USING doomed
        WHERE target.ctid = doomed.ctid
      `);
      const events = await tx.execute(sql`
        WITH doomed AS (
          SELECT event.ctid
          FROM alert_events AS event
          WHERE event.processed_at < ${historyCutoff}
            AND NOT EXISTS (
              SELECT 1
              FROM alert_notification_group_events AS membership
              WHERE membership.organization_id = event.organization_id
                AND membership.event_id = event.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM alert_delivery_events AS link
              INNER JOIN alert_deliveries AS delivery
                ON delivery.organization_id = link.organization_id
               AND delivery.dedup_key = link.delivery_dedup_key
              WHERE link.organization_id = event.organization_id
                AND link.event_id = event.id
                AND (
                  delivery.status = 'pending'
                  OR (
                    delivery.status = 'failed'
                    AND delivery.attempts < ${ALERT_DELIVERY_MAX_ATTEMPTS}
                  )
                )
            )
          ORDER BY event.processed_at, event.id
          LIMIT ${batchSize}
          FOR UPDATE OF event SKIP LOCKED
        )
        DELETE FROM alert_events AS target
        USING doomed
        WHERE target.ctid = doomed.ctid
      `);
      const deliveries = await tx.execute(sql`
        WITH doomed AS (
          SELECT delivery.ctid
          FROM alert_deliveries AS delivery
          WHERE delivery.updated_at < ${historyCutoff}
            AND (
              delivery.status = 'sent'
              OR (
                delivery.status = 'failed'
                AND delivery.attempts >= ${ALERT_DELIVERY_MAX_ATTEMPTS}
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM alert_delivery_events AS link
              WHERE link.organization_id = delivery.organization_id
                AND link.delivery_dedup_key = delivery.dedup_key
            )
          ORDER BY delivery.updated_at, delivery.dedup_key
          LIMIT ${batchSize}
          FOR UPDATE OF delivery SKIP LOCKED
        )
        DELETE FROM alert_deliveries AS target
        USING doomed
        WHERE target.ctid = doomed.ctid
      `);
      const notificationGroups = await tx.execute(sql`
        WITH doomed AS (
          SELECT notification_group.ctid
          FROM alert_notification_groups AS notification_group
          WHERE notification_group.updated_at < ${idleGroupCutoff}
            AND NOT EXISTS (
              SELECT 1
              FROM alert_notification_group_events AS membership
              WHERE membership.organization_id = notification_group.organization_id
                AND membership.group_id = notification_group.id
            )
          ORDER BY notification_group.updated_at, notification_group.id
          LIMIT ${batchSize}
          FOR UPDATE OF notification_group SKIP LOCKED
        )
        DELETE FROM alert_notification_groups AS target
        USING doomed
        WHERE target.ctid = doomed.ctid
      `);
      const silences = await tx.execute(sql`
        WITH doomed AS (
          SELECT ctid
          FROM alert_silences
          WHERE ends_at < ${historyCutoff}
          ORDER BY ends_at, id
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM alert_silences AS target
        USING doomed
        WHERE target.ctid = doomed.ctid
      `);
      const instances = await tx.execute(sql`
        WITH doomed AS (
          SELECT id
          FROM alert_instances
          WHERE status = 'inactive'
            AND updated_at < ${instanceCutoff}
          ORDER BY updated_at, id
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM alert_instances AS target
        USING doomed
        WHERE target.id = doomed.id
      `);

      return {
        alertEvaluations: deletedRows(alertEvaluations),
        events: deletedRows(events),
        deliveries: deletedRows(deliveries),
        notificationGroups: deletedRows(notificationGroups),
        silences: deletedRows(silences),
        instances: deletedRows(instances),
      };
    });
    totals = addCounts(totals, counts);
    if (Object.values(counts).every((count) => count < batchSize)) break;
    if (clock() >= deadline) break;
  }

  return totals;
}
