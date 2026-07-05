import type { ClickhouseQuery } from "@/lib/clickhouse";

export type AlertHistoryRow = {
  timestamp: string;
  eventType: string; // alert.event_type: instance_fired | instance_resolved | ...
  deliveryTargetsJson: string; // alert.delivery_targets (JSON object string)
  silenced: string; // "true" | "false"
  instanceLabelsJson: string; // alert.instance_labels (JSON object string)
  instanceFingerprint: string;
  rowCount: string;
};

/**
 * Per-alert event history from app.logs. The collector lands CC's alert events here
 * (ScopeName='everr.alerting'), keyed by alert.slug. Row-level security pins the tenant
 * via SQL_everr_tenant_id, so this never filters by organization_id in SQL.
 *
 * Per the locked cross-plan contract, the simple history list shows the per-instance
 * fire/resolve records: alert.event_type IN ('instance_fired','instance_resolved').
 */
export async function queryAlertHistory(
  clickhouse: ClickhouseQuery,
  slug: string,
  opts: { limit: number; fromISO: string; toISO: string },
): Promise<AlertHistoryRow[]> {
  return clickhouse<AlertHistoryRow>(
    `
      SELECT
        concat(formatDateTime(TimestampTime, '%Y-%m-%dT%H:%i:%S', 'UTC'), 'Z') AS timestamp,
        LogAttributes['alert.event_type']         AS eventType,
        LogAttributes['alert.delivery_targets']   AS deliveryTargetsJson,
        LogAttributes['alert.silenced']           AS silenced,
        LogAttributes['alert.instance_labels']    AS instanceLabelsJson,
        LogAttributes['alert.instance_fingerprint'] AS instanceFingerprint,
        LogAttributes['alert.row_count']          AS rowCount
      FROM app.logs
      WHERE ScopeName = 'everr.alerting'
        AND LogAttributes['alert.slug'] = {slug:String}
        AND LogAttributes['alert.event_type'] IN ('instance_fired', 'instance_resolved')
        AND TimestampTime >= {fromTime:String}
        AND TimestampTime <= {toTime:String}
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32}
    `,
    {
      slug,
      fromTime: opts.fromISO,
      toTime: opts.toISO,
      limit: opts.limit,
    },
  );
}
