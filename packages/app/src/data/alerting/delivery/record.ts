/**
 * The Notifications page's read of `app.alert_events`: what reached delivery
 * with nothing to carry it. The read names `is_live` and a time floor, for
 * the reasons `triage/history.ts` gives.
 */
import { ALERTING_SEVERITIES } from "@/data/alerting/vocabulary";
import type { ClickhouseQuery } from "@/lib/clickhouse";
import type { AlertingSeverity } from "../types";

export type UndeliveredRecord = {
  /** The rule's `project/slug` path. */
  path: string;
  severity: AlertingSeverity;
  count: number;
};

type Row = {
  slug: string;
  severity: string;
  undelivered: string;
};

/** One `no_channels` terminal per notification chain, by rule and severity. */
export async function loadUndeliveredRecords(
  query: ClickhouseQuery,
  window: { fromISO: string; toISO: string },
): Promise<UndeliveredRecord[]> {
  const rows = await query<Row>(
    `SELECT slug, severity,
            uniqExact(notification_event_id) AS undelivered
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
  const undelivered: UndeliveredRecord[] = [];
  for (const row of rows) {
    const count = Number(row.undelivered);
    // A severity outside the vocabulary cannot be laid on a tier and is
    // dropped rather than guessed.
    if (row.slug === "" || count === 0 || !isSeverity(row.severity)) continue;
    undelivered.push({ path: row.slug, severity: row.severity, count });
  }
  return undelivered;
}

function isSeverity(value: string): value is AlertingSeverity {
  return (ALERTING_SEVERITIES as readonly string[]).includes(value);
}
