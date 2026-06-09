import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  applyRouteTimeDefaults,
  REFRESH_OFF,
  type RefreshInterval,
  ResolvedTimeRangeSearchSchema,
} from "@/lib/time-range";
import { useRouteTimeDefaults } from "./use-time-range";

export function useAutoRefresh() {
  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const defaults = useRouteTimeDefaults();
  const { refresh } = ResolvedTimeRangeSearchSchema.parse(
    applyRouteTimeDefaults(search, defaults),
  );
  // The picker speaks "" for off; translate the durable REFRESH_OFF token back.
  const refreshInterval = refresh === REFRESH_OFF ? "" : refresh;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setRefreshInterval = (value: RefreshInterval) => {
    // Off ("") must persist as REFRESH_OFF only when a route default would
    // otherwise re-arm it; without one, drop the param for a clean URL.
    const next =
      value === "" && defaults.refresh ? REFRESH_OFF : value || undefined;
    void navigate({
      // @ts-expect-error -- route-agnostic navigation
      search: (prev) => ({
        ...prev,
        refresh: next,
      }),
      replace: true,
    });
  };

  const refreshNow = () => {
    void queryClient.invalidateQueries();
  };

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const ms = getRefreshIntervalMs(refreshInterval);
    if (ms) {
      intervalRef.current = setInterval(() => {
        void queryClient.invalidateQueries();
      }, ms);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [refreshInterval, queryClient]);

  return { refreshInterval, setRefreshInterval, refreshNow };
}
