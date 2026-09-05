/** Display formatting shared by the triage server functions and the charts
 *  that render their output. Pure, so the tests reach it without a database. */

/** "6h 12m", "14m", "3d 4h". Never "0m": a duration that short reads as "now". */
export function formatElapsed(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

export function formatSince(from: Date | null, now: Date): string | null {
  if (!from) return null;
  return formatElapsed(now.getTime() - from.getTime());
}

/**
 * The same elapsed time as a phrase that can start a sentence: "since 14m",
 * or the bare "just now", which takes no preposition. The preposition lives
 * here because only this module knows which phrasings `formatElapsed` emits.
 */
export function formatSincePhrase(from: Date | null, now: Date): string | null {
  const since = formatSince(from, now);
  if (since === null) return null;
  return since === "just now" ? since : `since ${since}`;
}

/** "3d 4h ago", or the bare "just now", which takes no suffix either. */
export function formatAgoPhrase(ms: number): string {
  const elapsed = formatElapsed(ms);
  return elapsed === "just now" ? elapsed : `${elapsed} ago`;
}

/**
 * Evaluated values keep the precision they were measured at, capped: a p99 of
 * 412.38176 is noise past the first decimal, and an integer count must not
 * grow a ".0" it never had.
 */
export function formatValue(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(Math.abs(value) < 10 ? 2 : 1);
}

/** `{ ServiceName: "checkout" }` as `ServiceName=checkout`. */
export function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "no labels";
  return entries.map(([k, v]) => `${k}=${v}`).join(" ");
}

export function formatClock(at: Date): string {
  return at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * What a silence did to delivery, in the history's own two words. A hold is
 * a notification the silence is sitting on and may still let through when it
 * lapses; a suppression is one that will never go out. Collapsing them into
 * a single "suppressed N" would claim the stronger fact for both.
 *
 * `null` when it did nothing, which is most silences. Printing that on every
 * row spends the reader's attention on the absence of an event, and buries
 * the handful of rows where something was actually withheld.
 */
export function silenceImpact(counts: {
  held: number;
  dropped: number;
}): string | null {
  const parts: string[] = [];
  if (counts.held > 0) parts.push(`held ${counts.held}`);
  if (counts.dropped > 0) parts.push(`dropped ${counts.dropped}`);
  return parts.length > 0 ? parts.join(" \u00b7 ") : null;
}
