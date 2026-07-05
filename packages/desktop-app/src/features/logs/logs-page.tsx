import {
  LogsExplorer,
  type LogsExplorerSearch,
  LogsRepository,
  LogsSearchFiltersShape,
} from "@everr/telemetry-explorer/logs";
import type { TimeRange } from "@everr/ui/components/time-range-picker";
import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { ExploreSearchShape } from "../explore/explore-search";
import { ExploreShell } from "../explore/explore-shell";
import { LocalTelemetryGate } from "../local-telemetry/collector-status";
import { localSqlClient } from "./local-sql-client";

// `services` lives in the shared topbar now (as the cross-page `service` param),
// so it is omitted from the per-page schema and the sidebar service control is
// hidden via `hideSharedFilters`.
export const LogsSearchSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    refresh: z.string().optional(),
    q: z.string().optional(),
    ...LogsSearchFiltersShape,
    ...ExploreSearchShape,
    traceId: z.string().optional(),
    showVolume: z.boolean().default(true),
  })
  .omit({ services: true });

type LogsSearch = z.infer<typeof LogsSearchSchema>;

export function LogsPage() {
  const search: LogsSearch = useSearch({ strict: false });
  const navigate = useNavigate();

  const repo = useMemo(() => new LogsRepository(localSqlClient), []);

  const service = search.service ?? [];
  const environment = search.environment ?? [];

  const timeRange: TimeRange = {
    from: search.from ?? DEFAULT_TIME_RANGE.from,
    to: search.to ?? DEFAULT_TIME_RANGE.to,
  };

  const explorerSearch: LogsExplorerSearch = {
    q: search.q,
    levels: search.levels,
    services: service,
    attributes: search.attributes,
    traceId: search.traceId,
    showVolume: search.showVolume,
  };

  return (
    <ExploreShell
      title="Logs"
      timeRange={timeRange}
      refresh={search.refresh ?? ""}
      service={service}
      environment={environment}
      onTimeRangeChange={(range) =>
        void navigate({
          to: "/logs",
          search: (prev) => ({ ...prev, from: range.from, to: range.to }),
          replace: true,
        })
      }
      onRefreshChange={(value) =>
        void navigate({
          to: "/logs",
          search: (prev) => ({ ...prev, refresh: value || undefined }),
          replace: true,
        })
      }
      onServiceChange={(values) =>
        void navigate({
          to: "/logs",
          search: (prev) => ({ ...prev, service: values }),
          replace: true,
        })
      }
      onEnvironmentChange={(values) =>
        void navigate({
          to: "/logs",
          search: (prev) => ({ ...prev, environment: values }),
          replace: true,
        })
      }
    >
      <LocalTelemetryGate>
        <LogsExplorer
          repo={repo}
          timeRange={timeRange}
          search={explorerSearch}
          environment={environment}
          hideSharedFilters
          onSearchChange={({ services: _ignored, ...next }) =>
            void navigate({
              to: "/logs",
              search: (prev) => ({ ...prev, ...next }),
              replace: true,
            })
          }
          onTimeRangeSelect={(from, to) =>
            void navigate({
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
      </LocalTelemetryGate>
    </ExploreShell>
  );
}
