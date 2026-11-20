import { usePageRefresh } from "@everr/ui/lib/refresh-epoch";
import type { QueryFilters } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { isSettledClipEvents } from "#app/data/replay/options.ts";
import {
  applyRouteTimeDefaults,
  type RefreshInterval,
  ResolvedTimeRangeSearchSchema,
} from "#app/lib/time-range.ts";
import { useRouteTimeDefaults } from "./use-time-range";

const REFRESH_FILTERS: QueryFilters = {
  predicate: (query) => !isSettledClipEvents(query),
};

export function useAutoRefresh() {
  const search = useSearch({
    from: "/_authenticated/_organization/_dashboard",
  });
  const defaults = useRouteTimeDefaults();
  const { refresh } = ResolvedTimeRangeSearchSchema.parse(applyRouteTimeDefaults(search, defaults));
  const navigate = useNavigate();

  const setRefreshInterval = (value: RefreshInterval) => {
    void navigate({
      // @ts-expect-error -- route-agnostic navigation
      search: (prev) => ({
        ...prev,
        refresh: value,
      }),
      replace: true,
    });
  };

  const refreshNow = usePageRefresh(refresh, REFRESH_FILTERS);

  return { refreshInterval: refresh, setRefreshInterval, refreshNow };
}
