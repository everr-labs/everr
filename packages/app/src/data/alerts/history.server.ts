import type { ClickhouseQuery } from "@/lib/clickhouse";
import type { AlertEventType } from "./event-types";

// A JSON value, spelled out so the evidence record stays serializable across the
// server-fn boundary (a bare `unknown` value trips TanStack's serializer).
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// alert.evidence_json decoded: source-row column name -> value.
export type AlertEvidence = { [key: string]: JsonValue };

// CC's evidence is a JSON object (column -> value). Anything that isn't a plain
// object (missing attribute, malformed JSON, an array) collapses to null.
function parseEvidence(json: string): AlertEvidence | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as AlertEvidence;
    }
  } catch {
    // malformed evidence -> null
  }
  return null;
}

// Parse a JSON object of instance labels into a string->string record. CC writes
// alert.instance_labels as a JSON object of strings; anything else collapses to {}.
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
    // malformed labels -> {}
  }
  return {};
}

// alert.delivery_targets: CC currently emits a comma-joined list of target names,
// but earlier shapes were JSON (array, or object of channel -> names). Accept all
// three so the reader survives records from any CC version.
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
      // fall through to the comma-joined form
    }
  }
  return t
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Distinct label keys alerts have actually carried (the keys of
 * alert.instance_labels across stored CC events), most frequent first. Backs
 * the matcher editors' key suggestions. Row-level security pins the tenant via
 * SQL_everr_tenant_id, so this never filters by organization_id in SQL.
 */
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
      GROUP BY key
      ORDER BY count() DESC, key ASC
      LIMIT {limit:UInt32}
    `,
    { fromTime: opts.fromISO, toTime: opts.toISO, limit: opts.limit },
  );
  return rows.map((r) => r.key);
}

/**
 * Distinct values one label key has actually carried across stored CC events,
 * most frequent first. Same tenancy story as queryObservedLabelKeys: the
 * row-level policy handles it, never a SQL org filter.
 */
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
  slug: string; // alert.slug (everr.name annotation, falling back to the rule id)
  instanceFingerprint: string;
  labels: Record<string, string>; // alert.instance_labels decoded
  // alert.severity when CC stamps it; empty today (records carry no severity attribute),
  // selected defensively so it flows through once CC adds it.
  severity: string;
  suppressed: boolean; // alert.suppressed === "true"
  silenced: boolean; // alert.silenced === "true" (only on dispatcher records)
  deliveryTargets: string[]; // alert.delivery_targets decoded (only on delivery records)
  evidence: AlertEvidence | null;
  evidenceTruncated: boolean; // alert.evidence_truncated === "true"
};

type AlertEventLogRawRow = {
  timestamp: string;
  // Asserted (not validated) at the ClickHouse read boundary: CC is the only
  // writer of ScopeName='everr.alerting' records and only emits this vocabulary.
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
 * Rule-agnostic alerting event log from app.logs: every CC event the collector landed
 * (ScopeName='everr.alerting'), regardless of slug or event type. Backs the monitor
 * stream's historical page under the live SSE tail. Row-level security pins the tenant
 * via SQL_everr_tenant_id, so this never filters by organization_id in SQL.
 *
 * ServiceName='alert' is CC's stable resource attribute (src/otel/exporter.rs; the
 * trusted collector pipeline passes it through). Filtering on it lets this scan use
 * the app.logs ORDER BY prefix (tenant_id, ServiceName, TimestampTime) instead of
 * skipping ServiceName. It also skips legacy 'alert-preview' rows from the retired
 * in-process evaluator; CC previews arrive as ServiceName='alert' with
 * alert.suppressed='true'.
 *
 * The time params are DateTime64(3) (not String) because resolveTimeRange emits
 * 'YYYY-MM-DD HH:mm:ss.SSS' and ClickHouse cannot coerce a fractional-seconds
 * string to the column's plain DateTime.
 */
export async function queryAlertEventLog(
  clickhouse: ClickhouseQuery,
  opts: { limit: number; fromISO: string; toISO: string },
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
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32}
    `,
    {
      fromTime: opts.fromISO,
      toTime: opts.toISO,
      limit: opts.limit,
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
