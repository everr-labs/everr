import { db } from "@/db/client";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import {
  type AlertDeliveryTargets,
  type AlertHistoryDefinition,
  deliveryHistoryRow,
  historyDefFromJournalRow,
  recordAlertHistory,
} from "../history/clickhouse";
import { linkedEventsForDeliveryQuery } from "./journal-reader";

/**
 * Channel type to the channel names it reached, for `delivery_targets`.
 *
 * Deliberately not the address. `app.alert_events` is append-only with a
 * retention TTL, so a webhook URL, a bot token, or a Telegram chat id written
 * here could not be withdrawn afterwards. The channel's user-chosen name
 * identifies it just as well and carries nothing sensitive.
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
};

async function deliveryLinkedEvents(
  organizationId: string,
  dedupKey: string,
): Promise<LinkedEvent[]> {
  const rows = await linkedEventsForDeliveryQuery(db, organizationId, dedupKey);
  return rows.map(({ event }) => ({
    id: event.id,
    definition: historyDefFromJournalRow(event),
    fingerprint: event.instanceFingerprint,
    labels: event.instanceLabels,
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
  /** The delivery row's own creation time, the same on every attempt. */
  deliveryCreatedAt: Date;
  attemptAt: Date;
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
          deliveryCreatedAt: opts.deliveryCreatedAt,
          attemptAt: opts.attemptAt,
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
    });
  }
}
