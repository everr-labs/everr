const ALERTING_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Day-first local timestamp with a deterministic 24-hour clock; null-safe. */
export function alertingFormatTs(
  ts: string | number | Date | null | undefined,
): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? String(ts)
    : ALERTING_DATE_TIME_FORMATTER.format(d);
}
