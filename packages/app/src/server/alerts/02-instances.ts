import { createHash } from "node:crypto";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { query } from "@/lib/clickhouse";

export interface FiringInstance {
  fingerprint: string;
  labels: Record<string, string>;
  // Start of the current firing streak. Absent when the backing event predates
  // this field or its timestamp failed to parse.
  firedAt?: Date;
}

export interface AlertInstance extends FiringInstance {
  row: Record<string, unknown>;
}

export interface InstanceDiff {
  newlyFired: AlertInstance[];
  nowResolved: FiringInstance[];
}

export function extractInstanceLabels(
  row: Record<string, unknown>,
  instanceLabelColumns: readonly string[],
): Record<string, string> {
  const labels: Record<string, string> = {};
  if (instanceLabelColumns.length > 0) {
    for (const column of instanceLabelColumns) {
      const value = row[column];
      labels[column] =
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
          ? String(value)
          : value === undefined || value === null
            ? ""
            : JSON.stringify(value);
    }
    return labels;
  }
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string") labels[key] = value;
  }
  return labels;
}

export function instanceFingerprint(labels: Record<string, string>): string {
  const canonical = Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join("\0");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

// firedAt is the evaluation time: it is only meaningful for instances that
// turn out to be newly fired (diffInstances keeps the previous set's own
// timestamps for everything else that consumers look at).
export function rowsToInstances(
  rows: readonly Record<string, unknown>[],
  instanceLabelColumns: readonly string[],
  firedAt: Date,
): AlertInstance[] {
  const instances: AlertInstance[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const labels = extractInstanceLabels(row, instanceLabelColumns);
    const fingerprint = instanceFingerprint(labels);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    instances.push({ fingerprint, labels, firedAt, row });
  }
  return instances;
}

export function diffInstances(
  previous: readonly FiringInstance[],
  current: readonly AlertInstance[],
): InstanceDiff {
  const previousFingerprints = new Set(previous.map((i) => i.fingerprint));
  const currentFingerprints = new Set(current.map((i) => i.fingerprint));
  return {
    newlyFired: current.filter((i) => !previousFingerprints.has(i.fingerprint)),
    nowResolved: previous.filter((i) => !currentFingerprints.has(i.fingerprint)),
  };
}

export function parseLabels(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    }
  } catch {
    // fall through to empty labels
  }
  return {};
}

// Derives the currently firing instance set from instance transition events:
// the latest instance event per fingerprint wins. Safe because evaluations for
// one definition never run concurrently (per-org Graphile queue) and event
// inserts use wait_for_async_insert=1.
export async function fetchFiringInstances(def: {
  id: string;
  organizationId: string;
  repoid: string;
  slug: string;
}): Promise<FiringInstance[]> {
  const rows = await query<{
    fingerprint: string;
    labelsJson: string;
    firedAt: string;
  }>(
    `
      SELECT
        instance_fingerprint AS fingerprint,
        argMax(instance_labels_json, event_time) AS labelsJson,
        argMax(event_type, event_time) AS lastEventType,
        max(event_time) AS firedAt
      FROM app.alert_events
      WHERE tenant_id = {organizationId:String}
        AND repoid = {repoid:String}
        AND slug = {slug:String}
        AND alert_definition_id = {alertDefinitionId:String}
        AND event_type IN ('instance_fired', 'instance_resolved')
      GROUP BY instance_fingerprint
      HAVING lastEventType = 'instance_fired'
    `,
    def.organizationId,
    {
      organizationId: def.organizationId,
      repoid: def.repoid,
      slug: def.slug,
      alertDefinitionId: def.id,
    },
  );
  // instance_fired is only emitted when an instance newly fires, so the latest
  // event (which the HAVING pins to instance_fired) marks the start of the
  // current firing streak.
  return rows.map((row) => ({
    fingerprint: row.fingerprint,
    labels: parseLabels(row.labelsJson),
    // ClickHouse DateTime64 comes back as "YYYY-MM-DD HH:MM:SS.mmm" in UTC.
    firedAt: parseTimestampAsUTC(row.firedAt) ?? undefined,
  }));
}
