import { usePageRefresh } from "@everr/ui/lib/refresh-epoch";
import {
  applyRouteTimeDefaults,
  ResolvedTimeRangeSearchSchema,
  type RouteTimeDefaults,
  type TimeRange,
} from "@everr/ui/lib/time-range";
import type { QueryFilters } from "@tanstack/react-query";
import { useMatches, useSearch } from "@tanstack/react-router";
import { useSearchPatch } from "./search-io";

const EMPTY_TIME_DEFAULTS: RouteTimeDefaults = {};

/**
 * Time defaults declared by the deepest active route via its loader data
 * (`{ timeDefaults }`). Routes that declare nothing fall through to the global
 * default, so this is a no-op everywhere except routes that opt in.
 */
function useRouteTimeDefaults(): RouteTimeDefaults {
  return useMatches({
    select: (matches) => {
      for (let i = matches.length - 1; i >= 0; i--) {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- loaderData is the union of every route's loader data; only the opted-in routes carry timeDefaults, a shape TS can't narrow to from the union.
        const data = matches[i]?.loaderData as { timeDefaults?: RouteTimeDefaults } | undefined;
        if (data?.timeDefaults) return data.timeDefaults;
      }
      return EMPTY_TIME_DEFAULTS;
    },
  });
}

/**
 * The search of the nearest match. The shell layout route validates `from`,
 * `to` and `refresh`, and a match carries the validated search of the routes
 * above it, so the header and every page under the shell read the same values
 * without naming the layout route, whose id differs in each app.
 */
function useTimeSearch() {
  const search = useSearch({ strict: false });
  const defaults = useRouteTimeDefaults();
  return ResolvedTimeRangeSearchSchema.parse(applyRouteTimeDefaults(search, defaults));
}

export function useTimeRange() {
  const { from, to } = useTimeSearch();
  const patchSearch = useSearchPatch();

  const setTimeRange = (range: TimeRange) => {
    patchSearch({ from: range.from, to: range.to });
  };

  return { timeRange: { from, to }, setTimeRange };
}

export function useAutoRefresh(scope?: QueryFilters) {
  const { refresh } = useTimeSearch();
  const patchSearch = useSearchPatch();

  const setRefreshInterval = (value: string) => {
    patchSearch({ refresh: value }, { replace: true });
  };

  const refreshNow = usePageRefresh(refresh, scope);

  return { refreshInterval: refresh, setRefreshInterval, refreshNow };
}
