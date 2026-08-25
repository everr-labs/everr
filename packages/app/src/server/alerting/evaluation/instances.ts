import { createHash } from "node:crypto";

interface AlertInstance {
  fingerprint: string;
  labels: Record<string, string>;
  row: Record<string, unknown>;
}

// A SQL NULL and the literal empty string are different values; collapsing
// both to "" would fingerprint two distinct series as the same instance.
// Missing columns (the key absent from the row entirely) still map to "",
// since there is no SQL value there to distinguish.
export const NULL_LABEL_VALUE = "<null>";

// The stored columns are the identity, and no empty list is re-derived here.
// Apply resolves the identity once against ClickHouse column types, which the
// row values alone cannot recover: a DateTime arrives as a JSON string, so
// inferring "every string cell" would make a new instance every evaluation. An
// empty list means the whole result is one instance.
export function extractInstanceLabels(
  row: Record<string, unknown>,
  instanceLabelColumns: readonly string[],
): Record<string, string> {
  const labels: Record<string, string> = {};
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
