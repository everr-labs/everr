/**
 * The Notifications page's reads of `app.alert_events`: what each channel
 * delivered over the window, and what reached delivery with nothing to carry
 * it. Both name `is_live` and a time floor, for the reasons `triage/history.ts`
 * gives.
 */
import type { ClickhouseQuery } from "@/lib/clickhouse";

export type ChannelDeliveryRecord = {
  channel: string;
  sent: number;
  failed: number;
  lastSentAt: string | null;
  lastError: string | null;
};

type ChannelDeliveryRow = {
  channel: string;
  sent: string;
  failed: string;
  last_sent_at: string;
  last_error: string;
};

/**
 * One record per channel name. A delivery is the unit: the dedup key names
 * one physical send, whatever number of instances rode in it and however
 * many attempts it took. A delivery that failed and then got through counts
 * as sent, with no failure; one that never got through counts as failed and
 * lends the channel its last error.
 *
 * `delivery_targets` maps channel type to the names reached, so the names
 * are flattened out of the map's values before grouping. A name nothing
 * delivered to in the window has no row here.
 */
export async function loadChannelDeliveryRecords(
  query: ClickhouseQuery,
  window: { fromISO: string; toISO: string },
): Promise<ChannelDeliveryRecord[]> {
  const rows = await query<ChannelDeliveryRow>(
    `SELECT channel,
            countIf(succeeded) AS sent,
            countIf(NOT succeeded) AS failed,
            toString(toUnixTimestamp64Milli(maxIf(last_time, succeeded))) AS last_sent_at,
            argMaxIf(last_error, last_time, NOT succeeded) AS last_error
       FROM (
         SELECT channel,
                delivery_dedup_key,
                max(event_type = 'delivery_succeeded') AS succeeded,
                max(event_time) AS last_time,
                argMax(error, event_time) AS last_error
           FROM app.alert_events
          ARRAY JOIN arrayFlatten(mapValues(delivery_targets)) AS channel
          WHERE is_live
            AND event_type IN ('delivery_succeeded', 'delivery_failed')
            AND event_time >= parseDateTimeBestEffort({from:String})
            AND event_time <= parseDateTimeBestEffort({to:String})
          GROUP BY channel, delivery_dedup_key
       )
      GROUP BY channel
      ORDER BY channel`,
    { from: window.fromISO, to: window.toISO },
  );
  return rows.map((row) => {
    const sent = Number(row.sent);
    return {
      channel: row.channel,
      sent,
      failed: Number(row.failed),
      // Epoch milliseconds, so the answer does not depend on the session
      // timezone the engine would print a DateTime in. The aggregate is the
      // epoch itself when nothing succeeded, not a time.
      lastSentAt:
        sent > 0 ? new Date(Number(row.last_sent_at)).toISOString() : null,
      lastError: row.last_error === "" ? null : row.last_error,
    };
  });
}

export type UndeliveredRecord = {
  /** The rule's `project/slug` path. */
  path: string;
  severity: string;
  count: number;
};

/**
 * Notifications the pipeline ended because nothing would carry them: a
 * `no_channels` terminal, one per notification chain. Grouped by rule and
 * severity, so the caller can lay each count at the door of the tier or the
 * rule that had no channel.
 */
export async function loadUndelivered(
  query: ClickhouseQuery,
  window: { fromISO: string; toISO: string },
): Promise<UndeliveredRecord[]> {
  const rows = await query<{ slug: string; severity: string; n: string }>(
    `SELECT slug, severity, uniqExact(notification_event_id) AS n
       FROM app.alert_events
      WHERE is_live
        AND event_type = 'notification_suppressed'
        AND reason = 'no_channels'
        AND event_time >= parseDateTimeBestEffort({from:String})
        AND event_time <= parseDateTimeBestEffort({to:String})
      GROUP BY slug, severity
      ORDER BY slug, severity`,
    { from: window.fromISO, to: window.toISO },
  );
  return rows.map((row) => ({
    path: row.slug,
    severity: row.severity,
    count: Number(row.n),
  }));
}
