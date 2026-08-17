import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { query } from "@/lib/clickhouse";
import { clickhouseIsoMillis } from "../history/clickhouse";
import {
  ALERTING_CHANNEL_HEALTH_HOURS,
  type AlertingChannelHealth,
} from "./health";

// The same bound the alerting history reads carry: this is a small, bounded
// aggregate over delivery rows, so a 30s runtime is a bug rather than a
// legitimately slow query.
const ALERTING_QUERY_SETTINGS = { max_execution_time: 30 };

type ChannelHealthRow = {
  channel: string;
  delivered: string | number;
  failed: string | number;
  lastSuccessAt: string;
  lastFailureAt: string;
  lastError: string;
};

function count(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * Recent delivery outcomes per channel name.
 *
 * Deliveries write one row per alert event they carried, so the figures count
 * distinct `delivery_dedup_key`s: one notification sent to one channel is one
 * delivery here however many alerts rode along in it.
 *
 * The sort key starts (tenant_id, repoid, slug, event_type, event_time), so
 * this org-wide read scans the delivery half of the partitions it touches
 * rather than seeking. That is the cheap half by two orders of magnitude
 * (evaluations live in their own partition), and delivery rows are one per
 * notification per channel.
 */
export async function queryClickHouseChannelHealth(
  organizationId: string,
  opts: { from: Date },
): Promise<AlertingChannelHealth[]> {
  const rows = await query<ChannelHealthRow>(
    `
      SELECT
        channel,
        uniqExactIf(delivery_dedup_key, succeeded) AS delivered,
        uniqExactIf(delivery_dedup_key, NOT succeeded) AS failed,
        ${clickhouseIsoMillis("maxIf(event_time, succeeded)")} AS lastSuccessAt,
        ${clickhouseIsoMillis("maxIf(event_time, NOT succeeded)")} AS lastFailureAt,
        argMaxIf(error, event_time, NOT succeeded) AS lastError
      FROM (
        SELECT
          event_time,
          event_type = 'delivery_succeeded' AS succeeded,
          delivery_dedup_key,
          error,
          arrayJoin(arrayFlatten(mapValues(delivery_targets))) AS channel
        FROM app.alert_events
        WHERE tenant_id = {organizationId:String}
          AND event_type IN ('delivery_succeeded', 'delivery_failed')
          AND event_time >= {from:DateTime64(3)}
          -- A preview rule never notifies, so a preview delivery row would be
          -- a contradiction; excluding them keeps that guarantee readable.
          AND is_live
      )
      GROUP BY channel
    `,
    organizationId,
    { organizationId, from: toClickHouseDateTime(opts.from) },
    ALERTING_QUERY_SETTINGS,
  );

  return rows.map((row) => {
    const delivered = count(row.delivered);
    const failed = count(row.failed);
    return {
      channel: row.channel,
      delivered,
      failed,
      // `maxIf` over no matching row yields the epoch, not null: the counts
      // are what says whether the timestamp means anything.
      lastSuccessAt: delivered > 0 ? row.lastSuccessAt : null,
      lastFailureAt: failed > 0 ? row.lastFailureAt : null,
      lastError: failed > 0 ? row.lastError : "",
    };
  });
}

export function alertingChannelHealthWindowStart(now: Date): Date {
  return new Date(now.getTime() - ALERTING_CHANNEL_HEALTH_HOURS * 3_600_000);
}
