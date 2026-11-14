import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "#app/data/alerting/delivery/config.ts";
import { ALERT_SEND_DELIVERY_TASK } from "#app/data/alerting/delivery/tasks.ts";
import { currentTraceLink } from "#app/data/alerting/trace-link.ts";
import { db, type Transaction } from "#app/db/client.ts";
import { alertDeliveries, alertHeldIssueDeliveries } from "#app/db/schema/index.ts";
import { addWorkerJobInTransaction } from "#app/server/worker/jobs.ts";

// An error stops being new after a week, and a week covers a weekend
// without anyone looking. An issue for anything older would only be noise.
const HOLD_DAYS = 7;

function holdCutoff(): Date {
  return new Date(Date.now() - HOLD_DAYS * 24 * 60 * 60 * 1000);
}

/** Issues waiting for each service's repository. */
export async function heldIssueCounts(organizationId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ service: alertHeldIssueDeliveries.serviceName, held: count() })
    .from(alertHeldIssueDeliveries)
    .where(
      and(
        eq(alertHeldIssueDeliveries.organizationId, organizationId),
        eq(alertHeldIssueDeliveries.reason, "repository"),
        gte(alertHeldIssueDeliveries.heldAt, holdCutoff()),
      ),
    )
    .groupBy(alertHeldIssueDeliveries.serviceName);
  return new Map(
    rows.flatMap((row) => (row.service === null ? [] : [[row.service, row.held] as const])),
  );
}

/** Issues on a channel waiting for one of its open issues to close. */
export async function capacityHeldCount(
  organizationId: string,
  channelName: string,
): Promise<number> {
  const [row] = await db
    .select({ held: count() })
    .from(alertHeldIssueDeliveries)
    .innerJoin(
      alertDeliveries,
      and(
        eq(alertDeliveries.organizationId, alertHeldIssueDeliveries.organizationId),
        eq(alertDeliveries.dedupKey, alertHeldIssueDeliveries.deliveryDedupKey),
      ),
    )
    .where(
      and(
        eq(alertHeldIssueDeliveries.organizationId, organizationId),
        eq(alertHeldIssueDeliveries.reason, "capacity"),
        gte(alertHeldIssueDeliveries.heldAt, holdCutoff()),
        eq(alertDeliveries.channelName, channelName),
      ),
    );
  return row?.held ?? 0;
}

/**
 * Run held deliveries again. Each runs the whole delivery once more: one
 * that still has to wait is held again, from the time it first waited.
 */
async function requeue(
  tx: Transaction,
  organizationId: string,
  dedupKeys: string[],
): Promise<number> {
  if (dedupKeys.length === 0) return 0;
  const reopened = await tx
    .update(alertDeliveries)
    .set({ status: "pending", attempts: 0, lastError: null, updatedAt: new Date() })
    .where(
      and(
        eq(alertDeliveries.organizationId, organizationId),
        inArray(alertDeliveries.dedupKey, dedupKeys),
        eq(alertDeliveries.status, "failed"),
      ),
    )
    .returning({ dedupKey: alertDeliveries.dedupKey });
  for (const { dedupKey } of reopened) {
    await addWorkerJobInTransaction(
      tx,
      ALERT_SEND_DELIVERY_TASK,
      { dedupKey, ...currentTraceLink() },
      {
        jobKey: `${ALERT_SEND_DELIVERY_TASK}:${dedupKey}`,
        jobKeyMode: "replace",
        maxAttempts: ALERT_DELIVERY_MAX_ATTEMPTS,
      },
    );
  }
  return reopened.length;
}

/** Send the issues waiting for a service's repository again. Returns how
 *  many were sent. */
export async function releaseHeldIssues(organizationId: string, service: string): Promise<number> {
  return db.transaction(async (tx) => {
    const held = await tx
      .select({ dedupKey: alertHeldIssueDeliveries.deliveryDedupKey })
      .from(alertHeldIssueDeliveries)
      .where(
        and(
          eq(alertHeldIssueDeliveries.organizationId, organizationId),
          eq(alertHeldIssueDeliveries.reason, "repository"),
          eq(alertHeldIssueDeliveries.serviceName, service),
          gte(alertHeldIssueDeliveries.heldAt, holdCutoff()),
        ),
      );
    return requeue(
      tx,
      organizationId,
      held.map((row) => row.dedupKey),
    );
  });
}

/**
 * Try the issue that matters most of those waiting for room, one per channel
 * and place, so they fill freed slots in order instead of racing for them.
 * What matters most is the alert's value now: for new errors, how many
 * requests hit the error in the last day. Returns how many were tried.
 */
export async function releaseCapacityHolds(): Promise<number> {
  const rows = await db.execute<{ organization_id: string; delivery_dedup_key: string }>(sql`
    SELECT DISTINCT ON (held.organization_id, delivery.channel_id, held.location)
      held.organization_id, held.delivery_dedup_key
    FROM alert_held_issue_deliveries AS held
    INNER JOIN alert_deliveries AS delivery
      ON delivery.organization_id = held.organization_id
     AND delivery.dedup_key = held.delivery_dedup_key
    LEFT JOIN alert_delivery_events AS link
      ON link.organization_id = held.organization_id
     AND link.delivery_dedup_key = held.delivery_dedup_key
    LEFT JOIN alert_events AS event
      ON event.organization_id = link.organization_id
     AND event.id = link.event_id
    INNER JOIN alert_instances AS instance
      ON instance.alert_definition_id = event.source_definition_id
     AND instance.fingerprint = event.instance_fingerprint
    WHERE held.reason = 'capacity'
      AND held.held_at >= ${holdCutoff()}
      AND delivery.status = 'failed'
      -- An alert that stopped firing while it waited opens nothing: for new
      -- errors, one that has not happened enough in the last day.
      AND instance.status = 'firing'
    ORDER BY held.organization_id, delivery.channel_id, held.location,
      instance.value DESC NULLS LAST, held.held_at
  `);
  const byOrganization = new Map<string, string[]>();
  for (const row of rows.rows) {
    const keys = byOrganization.get(row.organization_id) ?? [];
    keys.push(row.delivery_dedup_key);
    byOrganization.set(row.organization_id, keys);
  }
  let tried = 0;
  for (const [organizationId, dedupKeys] of byOrganization) {
    tried += await db.transaction((tx) => requeue(tx, organizationId, dedupKeys));
  }
  return tried;
}
