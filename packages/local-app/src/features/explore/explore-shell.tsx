import { RefreshPicker } from "@everr/ui/components/refresh-picker";
import { TimeRangePicker } from "@everr/ui/components/time-range-picker";
import type { TimeRange } from "@everr/ui/lib/time-range";
import {
  type QueryFilters,
  useIsFetching,
  useQueryClient,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PageTitleBar } from "../app-shell/title-bar";

const exploreQueries = {
  type: "active",
  predicate: ({ queryKey }) =>
    queryKey[0] === "logs" ||
    queryKey[0] === "errors" ||
    queryKey[0] === "traces",
} satisfies QueryFilters;

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
  const isFetching = useIsFetching(exploreQueries) > 0;

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
              onRefresh={() =>
                void queryClient.invalidateQueries(exploreQueries)
              }
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
