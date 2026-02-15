import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  getRefreshIntervalMs,
  type RefreshInterval,
  TimeRangeSearchSchema,
} from "@/lib/time-range";

export function useAutoRefresh() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const { refresh } = TimeRangeSearchSchema.parse(search);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setRefreshInterval = (value: RefreshInterval) => {
    void navigate({
      // @ts-expect-error -- route-agnostic navigation
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        refresh: value || undefined,
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

    const ms = getRefreshIntervalMs(refresh);
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
  }, [refresh, queryClient]);

  return { refreshInterval: refresh, setRefreshInterval, refreshNow };
}
