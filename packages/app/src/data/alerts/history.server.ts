import type { ClickhouseQuery } from "@/lib/clickhouse";
import type { AlertEventType } from "./event-types";

// An explicit JSON type keeps evidence serializable across server functions.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// alert.evidence_json decoded: source-row column name -> value.
export type AlertEvidence = { [key: string]: JsonValue };

// Evidence must be a JSON object.
function parseEvidence(json: string): AlertEvidence | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as AlertEvidence;
    }
  } catch {
    // Invalid evidence is ignored.
  }
  return null;
}

// Parse instance labels into strings.
function parseStringMap(json: string): Record<string, string> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [
          k,
          typeof v === "string" ? v : JSON.stringify(v),
        ]),
      );
    }
  } catch {
    // Invalid labels are ignored.
  }
  return {};
}

// Accept current comma-separated targets and legacy JSON shapes.
function parseDeliveryTargets(raw: string): string[] {
  if (!raw) return [];
  const t = raw.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed).flatMap(([channel, names]) =>
          Array.isArray(names)
            ? names.map((n) => `${channel}:${String(n)}`)
            : [`${channel}:${String(names)}`],
        );
      }
    } catch {
      // Try the current format.
    }
  }
  return t
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Excludes preview-rule records from a live reader.
 *
 * CC stamps `service.name = "alert"` on every record it writes, suppressed
 * preview evaluations included, so `ServiceName = 'alert'` alone no longer
 * separates them the way the retired `app.alert_events` MV's 'alert-preview'
 * service did. Without this an open preview branch interleaves its fired and
 * resolved events into the live audit trail, which is exactly the wrong thing
 * to happen mid-incident. The live rules listing pins `namespace: ""` for the
 * same reason.
 */
const NOT_SUPPRESSED = "AND LogAttributes['alert.suppressed'] != 'true'";

/** Observed alert label keys, ordered by frequency. */
export async function queryObservedLabelKeys(
  clickhouse: ClickhouseQuery,
  opts: { limit: number; fromISO: string; toISO: string },
): Promise<string[]> {
  const rows = await clickhouse<{ key: string }>(
    `
      SELECT arrayJoin(JSONExtractKeys(LogAttributes['alert.instance_labels'])) AS key
      FROM app.logs
      WHERE ServiceName = 'alert'
        AND ScopeName = 'everr.alerting'
        AND TimestampTime >= {fromTime:DateTime64(3)}
        AND TimestampTime <= {toTime:DateTime64(3)}
        ${NOT_SUPPRESSED}
      GROUP BY key
      ORDER BY count() DESC, key ASC
      LIMIT {limit:UInt32}
    `,
    { fromTime: opts.fromISO, toTime: opts.toISO, limit: opts.limit },
  );
  return rows.map((r) => r.key);
}

/** Observed values for a label key, ordered by frequency. */
export async function queryObservedLabelValues(
  clickhouse: ClickhouseQuery,
  key: string,
  opts: { limit: number; fromISO: string; toISO: string },
): Promise<string[]> {
  const rows = await clickhouse<{ value: string }>(
    `
      SELECT JSONExtractString(LogAttributes['alert.instance_labels'], {key:String}) AS value
      FROM app.logs
      WHERE ServiceName = 'alert'
        AND ScopeName = 'everr.alerting'
        AND TimestampTime >= {fromTime:DateTime64(3)}
        AND TimestampTime <= {toTime:DateTime64(3)}
        ${NOT_SUPPRESSED}
        AND value != ''
      GROUP BY value
      ORDER BY count() DESC, value ASC
      LIMIT {limit:UInt32}
    `,
    { key, fromTime: opts.fromISO, toTime: opts.toISO, limit: opts.limit },
  );
  return rows.map((r) => r.value);
}

// One row of the rule-agnostic alerting event log (all slugs, all event types).
export type AlertEventLogRow = {
  timestamp: string;
  // alert.event_type; the vocabulary lives in ./event-types.
  eventType: AlertEventType;
  slug: string; // alert.slug (the rule's first-class `name`, project/slug qualified)
  instanceFingerprint: string;
  labels: Record<string, string>; // alert.instance_labels decoded
  // Empty on events written before severity was added.
  severity: string;
  suppressed: boolean; // alert.suppressed === "true"
  silenced: boolean; // alert.silenced === "true" (only on dispatcher records)
  deliveryTargets: string[]; // alert.delivery_targets decoded (only on delivery records)
  evidence: AlertEvidence | null;
  evidenceTruncated: boolean; // alert.evidence_truncated === "true"
};

type AlertEventLogRawRow = {
  timestamp: string;
  // CC is the sole writer for this scope and vocabulary.
  eventType: AlertEventType;
  slug: string;
  instanceFingerprint: string;
  instanceLabelsJson: string;
  severity: string;
  suppressed: string;
  silenced: string;
  deliveryTargetsRaw: string;
  evidenceJson: string;
  evidenceTruncated: string;
};

/**
 * Reads CC alert history. Row policies enforce tenancy, while optional source
 * filters apply before the newest-event limit.
 */
export async function queryAlertEventLog(
  clickhouse: ClickhouseQuery,
  opts: {
    limit: number;
    fromISO: string;
    toISO: string;
    fingerprint?: string;
    slugs?: readonly string[];
    /**
     * Include suppressed (preview-rule) records. Off by default so the live
     * feed reads only live alerting; the History page turns it on exactly when
     * a preview is selected, matching how the rules listing swaps namespaces.
     */
    includeSuppressed?: boolean;
  },
): Promise<AlertEventLogRow[]> {
  const rows = await clickhouse<AlertEventLogRawRow>(
    `
      SELECT
        concat(formatDateTime(TimestampTime, '%Y-%m-%dT%H:%i:%S', 'UTC'), 'Z') AS timestamp,
        LogAttributes['alert.event_type']           AS eventType,
        LogAttributes['alert.slug']                 AS slug,
        LogAttributes['alert.instance_fingerprint'] AS instanceFingerprint,
        LogAttributes['alert.instance_labels']      AS instanceLabelsJson,
        LogAttributes['alert.severity']             AS severity,
        LogAttributes['alert.suppressed']           AS suppressed,
        LogAttributes['alert.silenced']             AS silenced,
        LogAttributes['alert.delivery_targets']     AS deliveryTargetsRaw,
        LogAttributes['alert.evidence_json']        AS evidenceJson,
        LogAttributes['alert.evidence_truncated']   AS evidenceTruncated
      FROM app.logs
      WHERE ServiceName = 'alert'
        AND ScopeName = 'everr.alerting'
        AND TimestampTime >= {fromTime:DateTime64(3)}
        AND TimestampTime <= {toTime:DateTime64(3)}
        ${opts.includeSuppressed === true ? "" : NOT_SUPPRESSED}
        ${opts.fingerprint !== undefined ? "AND LogAttributes['alert.instance_fingerprint'] = {fingerprint:String}" : ""}
        ${opts.slugs !== undefined ? "AND LogAttributes['alert.slug'] IN {slugs:Array(String)}" : ""}
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32}
    `,
    {
      fromTime: opts.fromISO,
      toTime: opts.toISO,
      limit: opts.limit,
      ...(opts.fingerprint !== undefined
        ? { fingerprint: opts.fingerprint }
        : {}),
      ...(opts.slugs !== undefined ? { slugs: [...opts.slugs] } : {}),
    },
  );
  return rows.map(
    ({
      instanceLabelsJson,
      suppressed,
      silenced,
      deliveryTargetsRaw,
      evidenceJson,
      evidenceTruncated,
      ...row
    }) => ({
      ...row,
      labels: parseStringMap(instanceLabelsJson),
      suppressed: suppressed === "true",
      silenced: silenced === "true",
      deliveryTargets: parseDeliveryTargets(deliveryTargetsRaw),
      evidence: parseEvidence(evidenceJson),
      evidenceTruncated: evidenceTruncated === "true",
    }),
  );
}
