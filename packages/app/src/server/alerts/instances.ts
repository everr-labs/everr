import { createHash } from "node:crypto";
import { query } from "@/lib/clickhouse";

export interface FiringInstance {
  fingerprint: string;
  labels: Record<string, string>;
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
        value === undefined || value === null ? "" : String(value);
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

export function rowsToInstances(
  rows: readonly Record<string, unknown>[],
  instanceLabelColumns: readonly string[],
): AlertInstance[] {
  const instances: AlertInstance[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const labels = extractInstanceLabels(row, instanceLabelColumns);
    const fingerprint = instanceFingerprint(labels);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    instances.push({ fingerprint, labels, row });
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
    nowResolved: previous.filter(
      (i) => !currentFingerprints.has(i.fingerprint),
    ),
  };
}

export function parseLabels(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
          k,
          String(v),
        ]),
      );
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
  const rows = await query<{ fingerprint: string; labelsJson: string }>(
    `
      SELECT
        instance_fingerprint AS fingerprint,
        argMax(instance_labels_json, event_time) AS labelsJson,
        argMax(event_type, event_time) AS lastEventType
      FROM app.alert_events
      WHERE organization_id = {organizationId:String}
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
  return rows.map((row) => ({
    fingerprint: row.fingerprint,
    labels: parseLabels(row.labelsJson),
  }));
}
