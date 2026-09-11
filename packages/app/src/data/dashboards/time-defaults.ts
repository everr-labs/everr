import { isValid } from "@everr/datemath";
import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import type { RouteTimeDefaults } from "@/lib/time-range";
import type { DashboardSpec } from "./schema";

/**
 * Translate a dashboard's saved time range, duration, and refresh interval into
 * route-level defaults. These are layered under the URL search params by the
 * time-range hooks (explicit URL values always win), so they seed the global
 * picker and the panels without writing anything to the URL. Returns undefined
 * when the dashboard declares nothing usable.
 */
export function dashboardTimeDefaults(
  spec: Pick<DashboardSpec, "duration" | "refreshInterval" | "timeRange">,
): RouteTimeDefaults | undefined {
  const defaults: RouteTimeDefaults = {};

  if (
    spec.timeRange &&
    isValid(spec.timeRange.from) &&
    isValid(spec.timeRange.to)
  ) {
    defaults.from = spec.timeRange.from;
    defaults.to = spec.timeRange.to;
  } else if (spec.duration && isValid(`now-${spec.duration}`)) {
    defaults.from = `now-${spec.duration}`;
    defaults.to = "now";
  }

  if (
    spec.refreshInterval &&
    getRefreshIntervalMs(spec.refreshInterval) !== null
  ) {
    defaults.refresh = spec.refreshInterval;
  }

  return Object.keys(defaults).length > 0 ? defaults : undefined;
}
