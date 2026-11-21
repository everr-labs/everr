export function parseTimestampAsUTC(timestamp: string): Date | null {
  const normalized = timestamp.trim();
  if (!normalized) return null;
  // ClickHouse DateTime is space-separated (`YYYY-MM-DD HH:MM:SS`, UTC, no
  // timezone): canonicalize the date/time separator to `T` (the space, or a
  // lowercase `t` — RFC 3339 permits it, and missing it would parse the value
  // as local time), then pin `Z` — but only when a time component is present
  // without an explicit timezone. A date-only value is already parsed as UTC
  // per the spec, and appending `Z` to it is out-of-spec (engines disagree);
  // doubling up an existing timezone (`...ZZ`) fails to parse everywhere.
  const isoish = normalized.replace(/[ t]/i, "T");
  const hasTime = isoish.includes("T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoish);
  const candidate = hasTime && !hasTimezone ? `${isoish}Z` : isoish;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatTimestampTimeOfDay(timestamp: string): string {
  const parsed = parseTimestampAsUTC(timestamp);
  return parsed ? parsed.toLocaleTimeString() : "—";
}

/** A row's time, local: "2:54:11 PM", or "Nov 10, 2:54:11 PM" when the list
 *  covers more than one day and the time alone would be ambiguous. */
export function formatRowTimestamp(timestamp: string, withDay: boolean): string {
  const parsed = parseTimestampAsUTC(timestamp);
  if (!parsed) return "—";
  const time = parsed.toLocaleTimeString();
  if (!withDay) return time;
  // Joined here rather than formatted as one: Safari's combined format reads
  // "Nov 21 at 8:46:35 PM", a character past the column the rows size for
  // "Nov 21, 8:46:35 PM", so it wrapped there and nowhere else.
  return `${parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export function formatRelativeTime(timestamp: string): string {
  const date = parseTimestampAsUTC(timestamp);
  if (!date) return "—";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "just now";

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
