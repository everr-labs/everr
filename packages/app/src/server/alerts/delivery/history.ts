import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { alertDeliveryEvents, alertEvents } from "@/db/schema";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import {
  type AlertDeliveryTargets,
  type AlertHistoryDefinition,
  deliveryHistoryRow,
  recordAlertHistory,
} from "../history/clickhouse";

/**
 * Channel type to the channel names it reached, for `delivery_targets`.
 *
 * Deliberately not the address. `app.alert_events` is append-only with a
 * retention TTL, so a webhook URL, a bot token, a Telegram chat id, or an email
 * recipient written here could not be withdrawn afterwards. The channel's
 * user-chosen name identifies it just as well and carries nothing sensitive.
 */
export function deliveryTargets(
  channelType: string,
  channelName: string,
): AlertDeliveryTargets {
  return { [channelType]: [channelName] };
}

type LinkedEvent = {
  id: string;
  definition: AlertHistoryDefinition;
  fingerprint: string;
  labels: Record<string, string>;
  occurredAt: Date;
};

/**
 * The alert events a delivery was built from. One delivery can cover several
 * events once grouping has merged them, and each gets its own trail row so a
 * per-instance history stays complete.
 */
async function deliveryLinkedEvents(
  organizationId: string,
  dedupKey: string,
): Promise<LinkedEvent[]> {
  const rows = await db
    .select({ event: alertEvents })
    .from(alertDeliveryEvents)
    .innerJoin(
      alertEvents,
      and(
        eq(alertDeliveryEvents.organizationId, alertEvents.organizationId),
        eq(alertDeliveryEvents.eventId, alertEvents.id),
      ),
    )
    .where(
      and(
        eq(alertDeliveryEvents.organizationId, organizationId),
        eq(alertDeliveryEvents.deliveryDedupKey, dedupKey),
      ),
    );
  return rows.map(({ event }) => ({
    id: event.id,
    definition: {
      id: event.sourceDefinitionId,
      organizationId: event.organizationId,
      repoid: event.repoid,
      slug: event.slug,
      previewId: event.previewId,
      severity: event.severity,
      ruleMuted: event.suppressed,
    },
    fingerprint: event.instanceFingerprint,
    labels: event.instanceLabels,
    occurredAt: event.occurredAt,
  }));
}

/**
 * One ClickHouse trail row per alert event this delivery carried.
 *
 * Never throws. It runs on the delivery path, where a raised error would either
 * replace the real send failure with a bookkeeping one or, worse, push a
 * successful send into the failure branch and have Graphile deliver it twice.
 * Recording history must never affect the operation that produced it.
 */
export async function recordDeliveryOutcome(opts: {
  organizationId: string;
  dedupKey: string;
  channelType: string;
  channelName: string;
  occurredAt: Date;
  outcome: "succeeded" | "failed";
  error?: string;
}): Promise<void> {
  try {
    const events = await deliveryLinkedEvents(
      opts.organizationId,
      opts.dedupKey,
    );
    const first = events[0];
    if (first === undefined) return;
    const targets = deliveryTargets(opts.channelType, opts.channelName);
    await recordAlertHistory(
      first.definition.id,
      events.map((event) =>
        deliveryHistoryRow({
          def: event.definition,
          notificationEventId: event.id,
          dedupKey: opts.dedupKey,
          occurredAt: opts.occurredAt,
          fingerprint: event.fingerprint,
          labels: event.labels,
          deliveryTargets: targets,
          outcome: opts.outcome,
          ...(opts.error === undefined ? {} : { error: opts.error }),
        }),
      ),
    );
  } catch (cause) {
    serverLogger.error("alerts.history.delivery_outcome_failed", {
      ...exceptionAttributes(cause),
      "alert.delivery.dedup_key": opts.dedupKey,
      "error.handled": true,
    });
  }
}
