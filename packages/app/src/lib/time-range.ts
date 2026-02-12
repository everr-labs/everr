import { isValid, resolve } from "@citric/datemath";
import { z } from "zod";

export const TimeRangeSchema = z.object({ from: z.string(), to: z.string() });
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const DEFAULT_TIME_RANGE: TimeRange = { from: "now-7d", to: "now" };

function toClickHouseDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

export function resolveTimeRange(range: TimeRange) {
  const fromDate = resolve(range.from, { roundUp: false });
  const toDate = resolve(range.to, { roundUp: true });
  return {
    fromDate,
    toDate,
    fromISO: toClickHouseDateTime(fromDate),
    toISO: toClickHouseDateTime(toDate),
  };
}

export const TimeRangeSearchSchema = z.object({
  from: z.string().default(DEFAULT_TIME_RANGE.from),
  to: z.string().default(DEFAULT_TIME_RANGE.to),
});

export function validateTimeRange(range: TimeRange): TimeRange {
  if (!isValid(range.from) || !isValid(range.to)) {
    return DEFAULT_TIME_RANGE;
  }
  const fromDate = resolve(range.from, { roundUp: false });
  const toDate = resolve(range.to, { roundUp: true });
  if (fromDate >= toDate) {
    return DEFAULT_TIME_RANGE;
  }
  return range;
}

export interface QuickRange {
  label: string;
  from: string;
  to: string;
}

export interface QuickRangeGroup {
  label: string;
  ranges: QuickRange[];
}

export const QUICK_RANGE_GROUPS: QuickRangeGroup[] = [
  {
    label: "Relative",
    ranges: [
      { label: "Last 5 minutes", from: "now-5m", to: "now" },
      { label: "Last 15 minutes", from: "now-15m", to: "now" },
      { label: "Last 1 hour", from: "now-1h", to: "now" },
      { label: "Last 6 hours", from: "now-6h", to: "now" },
      { label: "Last 12 hours", from: "now-12h", to: "now" },
      { label: "Last 24 hours", from: "now-24h", to: "now" },
      { label: "Last 2 days", from: "now-2d", to: "now" },
      { label: "Last 7 days", from: "now-7d", to: "now" },
      { label: "Last 14 days", from: "now-14d", to: "now" },
      { label: "Last 30 days", from: "now-30d", to: "now" },
      { label: "Last 90 days", from: "now-90d", to: "now" },
      { label: "Last 1 year", from: "now-1y", to: "now" },
    ],
  },
  {
    label: "Calendar",
    ranges: [
      { label: "Today", from: "now/d", to: "now/d" },
      { label: "Yesterday", from: "now-1d/d", to: "now-1d/d" },
      { label: "This week", from: "now/w", to: "now/w" },
      { label: "This month", from: "now/M", to: "now/M" },
    ],
  },
];

export const QUICK_RANGES: QuickRange[] = QUICK_RANGE_GROUPS.flatMap(
  (g) => g.ranges,
);

export function formatTimeRangeDisplay(range: TimeRange): string {
  const preset = QUICK_RANGES.find(
    (q) => q.from === range.from && q.to === range.to,
  );
  if (preset) return preset.label;
  return `${range.from} to ${range.to}`;
}

export { isValid as isValidDatemath };
