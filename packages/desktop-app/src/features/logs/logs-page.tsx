import {
  DEFAULT_TIME_RANGE,
  LogLevelSchema,
  LogsExplorer,
  type LogsExplorerSearch,
  LogsRepository,
} from "@everr/logs-explorer";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { localSqlClient } from "./local-sql-client";

export const LogsSearchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
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
  const repo = useMemo(
    () => new LogsRepository(localSqlClient, { tableName: "otel_logs" }),
    [],
  );

  const timeRange = {
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

  return (
    <div className="h-full">
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
  );
}
