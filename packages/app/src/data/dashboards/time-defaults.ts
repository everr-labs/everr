import { isValid } from "@everr/datemath";
import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import type { DashboardSpec } from "./schema";

export interface DashboardSearchPatch {
  from?: string;
  to?: string;
  refresh?: string;
}

/**
 * Compute URL search-param defaults from a dashboard's saved
 * duration/refreshInterval. Explicit URL params always win: a field is only
 * seeded when the URL carries no value for it. Returns null when there is
 * nothing to seed.
 */
export function dashboardSearchDefaults(
  spec: Pick<DashboardSpec, "duration" | "refreshInterval">,
  search: { from?: string; to?: string; refresh?: string },
): DashboardSearchPatch | null {
  const patch: DashboardSearchPatch = {};

  if (
    !search.from &&
    !search.to &&
    spec.duration &&
    isValid(`now-${spec.duration}`)
  ) {
    patch.from = `now-${spec.duration}`;
    patch.to = "now";
  }

  if (
    !search.refresh &&
    spec.refreshInterval &&
    getRefreshIntervalMs(spec.refreshInterval) !== null
  ) {
    patch.refresh = spec.refreshInterval;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
