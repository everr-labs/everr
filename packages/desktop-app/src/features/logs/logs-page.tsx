import {
  DEFAULT_TIME_RANGE,
  LogLevelSchema,
  LogsExplorer,
  type LogsExplorerSearch,
  LogsRepository,
} from "@everr/telemetry-explorer/logs";
import {
  getRefreshIntervalMs,
  RefreshPicker,
} from "@everr/ui/components/refresh-picker";
import {
  type TimeRange,
  TimeRangePicker,
} from "@everr/ui/components/time-range-picker";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { localSqlClient } from "./local-sql-client";

export const LogsSearchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  refresh: z.string().optional(),
  q: z.string().optional(),
  levels: z.array(LogLevelSchema).default([]),
  services: z.array(z.string()).default([]),
  repos: z.array(z.string()).default([]),
  traceId: z.string().optional(),
  showVolume: z.boolean().default(true),
});

export type LogsSearch = z.infer<typeof LogsSearchSchema>;

export function LogsPage() {
  const search = useSearch({ strict: false }) as LogsSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isFetching = useIsFetching() > 0;

  const repo = useMemo(
    () => new LogsRepository(localSqlClient, { tableName: "otel_logs" }),
    [],
  );

  const timeRange: TimeRange = {
    from: search.from ?? DEFAULT_TIME_RANGE.from,
    to: search.to ?? DEFAULT_TIME_RANGE.to,
  };

  const explorerSearch: LogsExplorerSearch = {
    q: search.q,
    levels: search.levels,
    services: search.services,
    repos: search.repos,
    traceId: search.traceId,
    showVolume: search.showVolume,
  };

  const setTimeRange = (range: TimeRange) =>
    navigate({
      to: "/logs",
      search: (prev) => ({ ...prev, from: range.from, to: range.to }),
      replace: true,
    });

  const setRefreshInterval = (value: string) =>
    navigate({
      to: "/logs",
      search: (prev) => ({ ...prev, refresh: value || undefined }),
      replace: true,
    });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const ms = search.refresh ? getRefreshIntervalMs(search.refresh) : null;
    if (ms) {
      intervalRef.current = setInterval(
        () => void queryClient.invalidateQueries(),
        ms,
      );
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [search.refresh, queryClient]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div
          data-tauri-drag-region
          className="flex flex-1 items-center self-stretch"
        >
          <span className="text-sm font-medium text-[var(--settings-text)]">
            Logs
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <TimeRangePicker value={timeRange} onChange={setTimeRange} />
          <RefreshPicker
            value={search.refresh ?? ""}
            onChange={setRefreshInterval}
            onRefresh={() => void queryClient.invalidateQueries()}
            isFetching={isFetching}
          />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <LogsExplorer
          repo={repo}
          timeRange={timeRange}
          search={explorerSearch}
          onSearchChange={(next) =>
            navigate({
              to: "/logs",
              search: (prev) => ({ ...prev, ...next }),
              replace: true,
            })
          }
          onTimeRangeSelect={(from, to) =>
            navigate({
              to: "/logs",
              search: (prev) => ({
                ...prev,
                from: from.toISOString(),
                to: to.toISOString(),
              }),
              replace: true,
            })
          }
        />
      </div>
    </div>
  );
}
