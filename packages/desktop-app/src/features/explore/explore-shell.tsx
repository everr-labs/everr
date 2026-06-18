import { ExploreGlobalFilters } from "@everr/telemetry-explorer/filters";
import { LogsRepository } from "@everr/telemetry-explorer/logs";
import { TracesRepository } from "@everr/telemetry-explorer/traces";
import {
  getRefreshIntervalMs,
  RefreshPicker,
} from "@everr/ui/components/refresh-picker";
import { TimeRangePicker } from "@everr/ui/components/time-range-picker";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { localSqlClient } from "../logs/local-sql-client";

// The Explore topbar's Service/Environment option lists are the UNION across
// logs + traces, so they stay identical on every Explore page. These repos exist
// only to feed those option dropdowns; the pages keep their own repos for data.
const filterLogsRepo = new LogsRepository(localSqlClient);
const filterTracesRepo = new TracesRepository(localSqlClient);

// Shared header for the Explore pages (Logs / Errors / Traces). Renders the page
// title plus the global Service + Environment filters on the left, and the time
// range + refresh controls on the right. Service/Environment are cross-page
// search params that persist as you navigate between the three pages.
export function ExploreShell({
  title,
  timeRange,
  refresh,
  service,
  environment,
  onTimeRangeChange,
  onRefreshChange,
  onServiceChange,
  onEnvironmentChange,
  children,
}: {
  title: string;
  timeRange: TimeRange;
  refresh: string;
  service: string[];
  environment: string[];
  onTimeRangeChange: (range: TimeRange) => void;
  onRefreshChange: (value: string) => void;
  onServiceChange: (values: string[]) => void;
  onEnvironmentChange: (values: string[]) => void;
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
      <header className="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        {/* flex-1 so the empty space stays a window drag handle (Tauri). */}
        <div
          data-tauri-drag-region
          className="flex flex-1 items-center self-stretch pl-[var(--titlebar-inset)]"
        >
          <span className="text-sm font-medium text-[var(--settings-text)]">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <TimeRangePicker value={timeRange} onChange={onTimeRangeChange} />
          <RefreshPicker
            value={refresh}
            onChange={onRefreshChange}
            onRefresh={() => void queryClient.invalidateQueries()}
            isFetching={isFetching}
          />
        </div>
      </header>
      {/* Service/Environment get their own toolbar so the header keeps its full
          drag region. The trailing filler stays draggable too. */}
      <div className="relative z-10 flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3">
        <ExploreGlobalFilters
          logsRepo={filterLogsRepo}
          tracesRepo={filterTracesRepo}
          timeRange={timeRange}
          service={service}
          environment={environment}
          onServiceChange={onServiceChange}
          onEnvironmentChange={onEnvironmentChange}
        />
        <div data-tauri-drag-region className="h-full flex-1" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
