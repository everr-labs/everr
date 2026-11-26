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

type Instant = Date | number | string;
export type ClockPrecision = "minute" | "second" | "millisecond";
/** "auto" shows the year only when it is not the current one. */
type YearDisplay = "auto" | "always" | "never";

// Always a zero-padded 24h clock, whatever the locale's own: letting the
// locale pick gave "14:54:11 PM" and rows of different widths.
const clock = (extra: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...extra,
  });
const CLOCK: Record<ClockPrecision, Intl.DateTimeFormat> = {
  minute: clock({}),
  second: clock({ second: "2-digit" }),
  millisecond: clock({ second: "2-digit", fractionalSecondDigits: 3 }),
};
const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function toDate(at: Instant): Date | null {
  const date = typeof at === "string" ? parseTimestampAsUTC(at) : new Date(at);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** "14:54", "14:54:11" or "14:54:11.078". */
export function formatClock(at: Instant, precision: ClockPrecision = "second"): string {
  const date = toDate(at);
  return date ? CLOCK[precision].format(date) : "—";
}

/** "Nov 10", or "Nov 10, 2025" with the year. */
export function formatDay(at: Instant, year: YearDisplay = "auto"): string {
  const date = toDate(at);
  if (!date) return "—";
  const withYear =
    year === "always" || (year === "auto" && date.getFullYear() !== new Date().getFullYear());
  return (withYear ? DAY_YEAR : DAY).format(date);
}

/** "Nov 10, 14:54:11". Joined by hand: Safari's combined format reads
 *  "Nov 21 at 20:46:35", too wide for the log column. */
export function formatDateTime(
  at: Instant,
  precision: ClockPrecision = "second",
  year: YearDisplay = "auto",
): string {
  return toDate(at) ? `${formatDay(at, year)}, ${formatClock(at, precision)}` : "—";
}

/** Both ends of a window, the end's date only when it is not the start's:
 *  ["Nov 10, 14:00", "16:30"]. */
export function formatWindowBounds(
  from: Instant,
  to: Instant,
  precision: ClockPrecision = "second",
): [string, string] {
  const sameDay = toDate(from)?.toDateString() === toDate(to)?.toDateString();
  const end = sameDay ? formatClock(to, precision) : formatDateTime(to, precision);
  return [formatDateTime(from, precision), end];
}

/** A row's time: "14:54:11", or "Nov 10, 14:54:11" when the list spans days.
 *  No year: the column is sized for this. */
export function formatRowTimestamp(timestamp: string, withDay: boolean): string {
  return withDay ? formatDateTime(timestamp, "second", "never") : formatClock(timestamp);
}

export function formatRelativeTime(at: Instant): string {
  const date = toDate(at);
  if (!date) return "—";
  const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}
