/**
 * The Notifications page's read of `app.alert_events`: what each channel
 * delivered over the window, and what reached delivery with nothing to carry
 * it, in one query. Two queries in one server function serialise on the
 * ClickHouse side, so both grains come out of one scan through GROUPING
 * SETS. The read names `is_live` and a time floor, for the reasons
 * `triage/history.ts` gives.
 */
import { ALERTING_SEVERITIES } from "@/data/alerting/vocabulary";
import type { ClickhouseQuery } from "@/lib/clickhouse";
import type { AlertingSeverity } from "../types";

export type ChannelDeliveryRecord = {
  channel: string;
  sent: number;
  failed: number;
  lastSentAt: string | null;
  lastError: string | null;
};

export type UndeliveredRecord = {
  /** The rule's `project/slug` path. */
  path: string;
  severity: AlertingSeverity;
  count: number;
};

export type DeliveryRecords = {
  /** One record per channel name a send reached. A name nothing delivered
   *  to in the window has no record. */
  channels: ChannelDeliveryRecord[];
  /** Notifications the pipeline ended because nothing would carry them: a
   *  `no_channels` terminal, one per chain, by rule and severity. */
  undelivered: UndeliveredRecord[];
};

type Row = {
  channel: string;
  slug: string;
  severity: string;
  sent: string;
  failed: string;
  last_sent_at: string;
  last_error: string;
  undelivered: string;
};

/**
 * A delivery is the unit: the dedup key names one physical send, whatever
 * number of instances rode in it and however many attempts it took. A send
 * that failed and then got through counts as sent; one that never got
 * through counts as failed. The error is the latest a failed attempt drew.
 *
 * `delivery_targets` maps channel type to the names reached, flattened out
 * of the map before grouping. The terminal rows carry no targets, so the
 * outer join gives them an empty channel, and the two grouping sets keep
 * the two grains apart: a channel row has a channel, a rule row has a slug.
 */
export async function loadDeliveryRecords(
  query: ClickhouseQuery,
  window: { fromISO: string; toISO: string },
): Promise<DeliveryRecords> {
  const rows = await query<Row>(
    `SELECT channel, slug, severity,
            uniqExactIf(delivery_dedup_key, event_type = 'delivery_succeeded') AS sent,
            uniqExactIf(delivery_dedup_key, event_type IN ('delivery_succeeded', 'delivery_failed')) - sent AS failed,
            toString(toUnixTimestamp64Milli(maxIf(event_time, event_type = 'delivery_succeeded'))) AS last_sent_at,
            argMaxIf(error, event_time, event_type = 'delivery_failed') AS last_error,
            uniqExactIf(notification_event_id, event_type = 'notification_suppressed') AS undelivered
       FROM app.alert_events
       LEFT ARRAY JOIN arrayFlatten(mapValues(delivery_targets)) AS channel
      WHERE is_live
        AND event_type IN ('delivery_succeeded', 'delivery_failed', 'notification_suppressed')
        AND (event_type != 'notification_suppressed' OR reason = 'no_channels')
        AND event_time >= parseDateTimeBestEffort({from:String})
        AND event_time <= parseDateTimeBestEffort({to:String})
      GROUP BY GROUPING SETS ((channel), (slug, severity))
      ORDER BY channel, slug, severity`,
    { from: window.fromISO, to: window.toISO },
  );
  const channels: ChannelDeliveryRecord[] = [];
  const undelivered: UndeliveredRecord[] = [];
  for (const row of rows) {
    if (row.channel !== "") {
      const sent = Number(row.sent);
      channels.push({
        channel: row.channel,
        sent,
        failed: Number(row.failed),
        // Epoch milliseconds, so the answer does not depend on the session
        // timezone the engine would print a DateTime in. The aggregate is
        // the epoch itself when nothing succeeded, not a time.
        lastSentAt:
          sent > 0 ? new Date(Number(row.last_sent_at)).toISOString() : null,
        lastError: row.last_error === "" ? null : row.last_error,
      });
      continue;
    }
    const count = Number(row.undelivered);
    // The rule grain also sums the delivery rows of rules that delivered
    // fine; only a count of terminals is a gap. A severity outside the
    // vocabulary cannot be laid on a tier and is dropped rather than guessed.
    if (row.slug === "" || count === 0 || !isSeverity(row.severity)) continue;
    undelivered.push({ path: row.slug, severity: row.severity, count });
  }
  return { channels, undelivered };
}

function isSeverity(value: string): value is AlertingSeverity {
  return (ALERTING_SEVERITIES as readonly string[]).includes(value);
}
