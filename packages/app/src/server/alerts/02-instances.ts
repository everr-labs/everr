import { createHash } from "node:crypto";

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
    nowResolved: previous.filter(
      (i) => !currentFingerprints.has(i.fingerprint),
    ),
  };
}
