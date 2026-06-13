import type { SignalCounts } from "./pricing";

/** Per-signal counts for one time bucket (a day or a month, UTC). */
export interface UsageBucket extends SignalCounts {
  /** Bucket start as an ISO instant, e.g. "2026-06-01T00:00:00Z". */
  bucket: string;
}

export interface CurrentPeriodUsage {
  /** Billing period boundaries (calendar month, UTC) as ISO instants. */
  periodStart: string;
  periodEnd: string;
  /** Server clock when the query ran — the forecast anchors to it. */
  now: string;
  totals: SignalCounts;
  /** One entry per day from period start through today, zero-filled. */
  daily: UsageBucket[];
}

export interface RangeUsage {
  /** Resolved range boundaries as ISO instants. */
  from: string;
  to: string;
  granularity: "hour" | "day";
  totals: SignalCounts;
  /** One entry per bucket across the range, zero-filled. */
  buckets: UsageBucket[];
}

export interface UsageHistory {
  /** One entry per calendar month, oldest first, zero-filled. The last entry
   * is the current (partial) period. */
  months: UsageBucket[];
}
