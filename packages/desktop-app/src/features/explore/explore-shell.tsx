import {
  getRefreshIntervalMs,
  RefreshPicker,
} from "@everr/ui/components/refresh-picker";
import { TimeRangePicker } from "@everr/ui/components/time-range-picker";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { PageTitleBar } from "../desktop-shell/title-bar";

// The shared header for the Explore pages: Logs, Errors and Traces. It holds the
// page title, the time range control and the refresh control.
export function ExploreShell({
  title,
  timeRange,
  refresh,
  onTimeRangeChange,
  onRefreshChange,
  children,
}: {
  title: string;
  timeRange: TimeRange;
  refresh: string;
  onTimeRangeChange: (range: TimeRange) => void;
  onRefreshChange: (value: string) => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const isFetching = useIsFetching() > 0;
  const refreshMs = useMemo(
    () => (refresh ? getRefreshIntervalMs(refresh) : null),
    [refresh],
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (refreshMs) {
      intervalRef.current = setInterval(
        () => void queryClient.invalidateQueries(),
        refreshMs,
      );
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshMs, queryClient]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title={title}
        actions={
          <>
            <TimeRangePicker value={timeRange} onChange={onTimeRangeChange} />
            <RefreshPicker
              value={refresh}
              onChange={onRefreshChange}
              onRefresh={() => void queryClient.invalidateQueries()}
              isFetching={isFetching}
            />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
