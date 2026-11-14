export const MAX_EVIDENCE_ROWS = 50;
export const MAX_EVIDENCE_BYTES = 64 * 1024;
export const MAX_EVENT_EVIDENCE_COLUMNS = 16;
export const MAX_EVENT_EVIDENCE_BYTES = 4 * 1024;

interface BoundedEvidence {
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
  const fitted = fitEvidence(Object.fromEntries(kept), MAX_EVENT_EVIDENCE_BYTES);
  return { evidence: fitted.evidence, truncated: fitted.cut || kept.length < entries.length };
}

const CUT_MARK = "…";

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/**
 * Evidence within `max` bytes of JSON, shrunk rather than dropped: the
 * largest values go first, a string cut to the longest prefix that fits and
 * marked with an ellipsis, anything else left out. The small columns a
 * template or a delivery reads, such as a service name, survive one long
 * stack trace beside them.
 */
function fitEvidence(
  evidence: Record<string, unknown>,
  max: number,
): { evidence: Record<string, unknown>; cut: boolean } {
  let size = jsonBytes(evidence);
  if (size <= max) return { evidence, cut: false };
  const fitted = { ...evidence };
  const largestFirst = Object.keys(fitted).sort(
    (a, b) => jsonBytes(fitted[b]) - jsonBytes(fitted[a]) || a.localeCompare(b),
  );
  for (const key of largestFirst) {
    const value = fitted[key];
    const rest = size - jsonBytes(value);
    if (typeof value === "string") {
      const prefix = longestFittingPrefix(value, max - rest);
      fitted[key] = prefix;
      size = rest + jsonBytes(prefix);
    } else {
      delete fitted[key];
      // The key, its quotes, the colon, and a comma go with it.
      size = jsonBytes(fitted);
    }
    if (size <= max) return { evidence: fitted, cut: true };
  }
  return { evidence: {}, cut: true };
}

// Cut by code point, so a cut never splits a character's UTF-8 bytes or a
// surrogate pair. `budget` is what the value's JSON may take, quotes included.
function longestFittingPrefix(value: string, budget: number): string {
  const chars = Array.from(value);
  const fits = (length: number) => jsonBytes(chars.slice(0, length).join("") + CUT_MARK) <= budget;
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return chars.slice(0, low).join("") + CUT_MARK;
}

export function boundEvidence(rows: Record<string, unknown>[]): BoundedEvidence {
  let kept = rows.slice(0, MAX_EVIDENCE_ROWS);
  let truncated = rows.length > MAX_EVIDENCE_ROWS;
  let json = JSON.stringify(kept);

  while (Buffer.byteLength(json, "utf8") > MAX_EVIDENCE_BYTES && kept.length > 1) {
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
