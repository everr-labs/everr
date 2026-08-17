export const MAX_EVIDENCE_ROWS = 50;
export const MAX_EVIDENCE_BYTES = 64 * 1024;
export const MAX_EVENT_EVIDENCE_COLUMNS = 16;
const MAX_EVENT_EVIDENCE_BYTES = 4 * 1024;

export interface BoundedEvidence {
  json: string;
  truncated: boolean;
  rowCount: number;
}

export function boundEventEvidence(
  row: Record<string, unknown>,
  labels: Record<string, string>,
): { evidence: Record<string, unknown>; truncated: boolean } {
  const entries = Object.entries(row).filter(([key]) => !(key in labels));
  const kept = entries.slice(0, MAX_EVENT_EVIDENCE_COLUMNS);
  const evidence = Object.fromEntries(kept);
  const truncated = kept.length < entries.length;
  if (
    Buffer.byteLength(JSON.stringify(evidence), "utf8") >
    MAX_EVENT_EVIDENCE_BYTES
  ) {
    return { evidence: {}, truncated: true };
  }
  return { evidence, truncated };
}

export function boundEvidence(
  rows: Record<string, unknown>[],
): BoundedEvidence {
  let kept = rows.slice(0, MAX_EVIDENCE_ROWS);
  let truncated = rows.length > MAX_EVIDENCE_ROWS;
  let json = JSON.stringify(kept);

  while (
    Buffer.byteLength(json, "utf8") > MAX_EVIDENCE_BYTES &&
    kept.length > 1
  ) {
    kept = kept.slice(0, Math.ceil(kept.length / 2));
    truncated = true;
    json = JSON.stringify(kept);
  }
  if (Buffer.byteLength(json, "utf8") > MAX_EVIDENCE_BYTES) {
    kept = [];
    truncated = true;
    json = "[]";
  }
  return { json, truncated, rowCount: rows.length };
}
