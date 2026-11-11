const NAMED = 8;

/**
 * An accessible name for a chart drawn on a canvas, which has no text of its
 * own: what kind of chart it is and what it shows, e.g. "Bar chart of p50,
 * p95". Long lists name the first few.
 */
export function chartLabel(kind: string, names: readonly string[]): string {
  if (names.length === 0) return kind;
  const more = names.length > NAMED ? `, and ${names.length - NAMED} more` : "";
  return `${kind} of ${names.slice(0, NAMED).join(", ")}${more}`;
}
