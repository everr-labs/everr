import { isValid } from "@everr/datemath";
import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import type { RouteTimeDefaults } from "@/lib/time-range";
import type { DashboardSpec } from "./schema";

/**
 * Translate a dashboard's saved `duration`/`refreshInterval` into route-level
 * time defaults. These are layered UNDER the URL search params by the time-range
 * hooks (explicit URL values always win), so they seed the global picker and the
 * panels without writing anything to the URL. Returns undefined when the
 * dashboard declares nothing usable.
 */
export function dashboardTimeDefaults(
  spec: Pick<DashboardSpec, "duration" | "refreshInterval">,
): RouteTimeDefaults | undefined {
  const defaults: RouteTimeDefaults = {};

  if (spec.duration && isValid(`now-${spec.duration}`)) {
    defaults.from = `now-${spec.duration}`;
    defaults.to = "now";
  }

  if (spec.refreshInterval && getRefreshIntervalMs(spec.refreshInterval) !== null) {
    defaults.refresh = spec.refreshInterval;
  }

  return Object.keys(defaults).length > 0 ? defaults : undefined;
}
