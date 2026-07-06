import type { ClickhouseQuery } from "@/lib/clickhouse";

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

export type AlertHistoryRow = {
  timestamp: string;
  eventType: string; // alert.event_type: instance_fired | instance_resolved | ...
  deliveryTargetsJson: string; // alert.delivery_targets (JSON object string)
  silenced: string; // "true" | "false"
  instanceLabelsJson: string; // alert.instance_labels (JSON object string)
  instanceFingerprint: string;
  rowCount: string;
  // alert.evidence_json parsed into the instance's source-row columns beyond its
  // identity labels (value column included). null when absent or malformed.
  evidence: AlertEvidence | null;
  evidenceTruncated: boolean; // alert.evidence_truncated === "true"
};

// Raw ClickHouse projection: every LogAttributes lookup lands as a string, so
// evidence is parsed from evidenceJson after the query returns.
type AlertHistoryRawRow = Omit<
  AlertHistoryRow,
  "evidence" | "evidenceTruncated"
> & {
  evidenceJson: string;
  evidenceTruncated: string;
};

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
  const rows = await clickhouse<AlertHistoryRawRow>(
    `
      SELECT
        concat(formatDateTime(TimestampTime, '%Y-%m-%dT%H:%i:%S', 'UTC'), 'Z') AS timestamp,
        LogAttributes['alert.event_type']         AS eventType,
        LogAttributes['alert.delivery_targets']   AS deliveryTargetsJson,
        LogAttributes['alert.silenced']           AS silenced,
        LogAttributes['alert.instance_labels']    AS instanceLabelsJson,
        LogAttributes['alert.instance_fingerprint'] AS instanceFingerprint,
        LogAttributes['alert.row_count']          AS rowCount,
        LogAttributes['alert.evidence_json']      AS evidenceJson,
        LogAttributes['alert.evidence_truncated'] AS evidenceTruncated
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
  return rows.map(({ evidenceJson, evidenceTruncated, ...row }) => ({
    ...row,
    evidence: parseEvidence(evidenceJson),
    evidenceTruncated: evidenceTruncated === "true",
  }));
}
