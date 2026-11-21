import { usePageRefresh } from "@everr/ui/lib/refresh-epoch";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  applyRouteTimeDefaults,
  type RefreshInterval,
  ResolvedTimeRangeSearchSchema,
} from "#app/lib/time-range.ts";
import { useRouteTimeDefaults } from "./use-time-range";

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

  const refreshNow = usePageRefresh(refresh);

  return { refreshInterval: refresh, setRefreshInterval, refreshNow };
}
