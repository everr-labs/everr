import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { refreshSkips } from "#app/data/replay/options.ts";
import {
  applyRouteTimeDefaults,
  type RefreshInterval,
  ResolvedTimeRangeSearchSchema,
} from "#app/lib/time-range.ts";
import { useRouteTimeDefaults } from "./use-time-range";

function refreshQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ predicate: (query) => !refreshSkips(query) });
}

export function useAutoRefresh() {
  const search = useSearch({
    from: "/_authenticated/_organization/_dashboard",
  });
  const defaults = useRouteTimeDefaults();
  const { refresh } = ResolvedTimeRangeSearchSchema.parse(applyRouteTimeDefaults(search, defaults));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const refreshNow = () => {
    refreshQueries(queryClient);
  };

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const ms = getRefreshIntervalMs(refresh);
    if (ms) {
      intervalRef.current = setInterval(() => refreshQueries(queryClient), ms);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [refresh, queryClient]);

  return { refreshInterval: refresh, setRefreshInterval, refreshNow };
}
