import { isValid } from "@everr/datemath";
import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import * as z from "zod";

const datemath = z.string().refine(isValid);

export type RefreshInterval = string;

export const TimeRangeSearchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  refresh: z.string().optional(),
});

export const ResolvedTimeRangeSearchSchema = z.object({
  from: datemath
    .catch(DEFAULT_TIME_RANGE.from)
    .default(DEFAULT_TIME_RANGE.from),
  to: datemath.catch(DEFAULT_TIME_RANGE.to).default(DEFAULT_TIME_RANGE.to),
  refresh: z.string().default("off"),
});

/**
 * A route-level default time range/refresh, layered UNDER the URL search params.
 * Lets a route (e.g. a dashboard with a saved `duration`) seed the global time
 * picker and its panels without writing to the URL.
 */
export interface RouteTimeDefaults {
  from?: string;
  to?: string;
  refresh?: string;
}

/**
 * Layer a route's time defaults beneath the URL search params. Explicit URL
 * values always win. The default *range* applies only when the URL carries no
 * range at all, so a half-specified URL (only `from`) is never mixed with a
 * default `to`. The result still needs `ResolvedTimeRangeSearchSchema` to fill
 * the global fallback for anything left undefined.
 *
 * `refresh` uses nullish-coalescing (not `||`) so an explicit "off" in the URL
 * wins over the route default instead of being treated as "unset" and re-armed.
 */
export function applyRouteTimeDefaults(
  search: { from?: string; to?: string; refresh?: string },
  defaults: RouteTimeDefaults,
): { from?: string; to?: string; refresh?: string } {
  const noUrlRange = !search.from && !search.to;
  return {
    from: search.from ?? (noUrlRange ? defaults.from : undefined),
    to: search.to ?? (noUrlRange ? defaults.to : undefined),
    refresh: search.refresh ?? defaults.refresh,
  };
}

export type BucketGranularity = "hour" | "day";

export function getBucketGranularity(
  fromDate: Date,
  toDate: Date,
): BucketGranularity {
  const hours = (toDate.getTime() - fromDate.getTime()) / 3_600_000;
  return hours <= 36 ? "hour" : "day";
}
