import { createHash } from "node:crypto";

export interface AlertInstance {
  fingerprint: string;
  labels: Record<string, string>;
  row: Record<string, unknown>;
}

// A SQL NULL and the literal empty string are different values; collapsing
// both to "" would fingerprint two distinct series as the same instance.
// Missing columns (the key absent from the row entirely) still map to "",
// since there is no SQL value there to distinguish.
export const NULL_LABEL_VALUE = "<null>";

export function extractInstanceLabels(
  row: Record<string, unknown>,
  instanceLabelColumns: readonly string[],
): Record<string, string> {
  const labels: Record<string, string> = {};
  if (instanceLabelColumns.length > 0) {
    for (const column of instanceLabelColumns) {
      const value = row[column];
      labels[column] =
        value === undefined
          ? ""
          : value === null
            ? NULL_LABEL_VALUE
            : String(value);
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
