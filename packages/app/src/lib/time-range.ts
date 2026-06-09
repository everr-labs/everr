import { isValid } from "@everr/datemath";
import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import * as z from "zod";

const datemath = z.string().refine(isValid);

export type RefreshInterval = string;

/**
 * Durable URL token for an *explicitly* disabled auto-refresh. The picker's own
 * "off" value is the empty string, but that is indistinguishable from "unset"
 * once it round-trips the URL (it gets stripped, see the `_dashboard` route's
 * `stripSearchParams`). A route with a saved refresh default would then re-arm
 * itself. This sentinel lets an explicit off survive as a real search param so
 * it can win over the route default; it is mapped back to "" at the picker.
 */
export const REFRESH_OFF = "off";

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
  refresh: z.string().default(""),
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
 * `refresh` uses nullish-coalescing (not `||`) so an explicit off — carried as
 * `REFRESH_OFF` or "" — wins over the route default instead of being treated as
 * "unset" and re-armed.
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
