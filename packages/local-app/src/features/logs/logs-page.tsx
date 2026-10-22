import {
  LogsExplorer,
  type LogsExplorerSearch,
  LogsRepository,
  type LogsSearch,
} from "@everr/telemetry-explorer/logs";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { ExploreShell } from "../explore/explore-shell";
import { ExplorePersistentFilters } from "../explore/persistent-filters";
import { useExploreControls } from "../explore/use-explore-controls";
import { LocalTelemetryGate } from "../local-telemetry/collector-status";
import { localSqlClient } from "./local-sql-client";

export function LogsPage() {
  const search: LogsSearch = useSearch({ strict: false });
  const navigate = useNavigate();
  const controls = useExploreControls("/logs");

  const repo = useMemo(() => new LogsRepository(localSqlClient), []);

  const service = search.service ?? [];
  const environment = search.environment ?? [];

  const { timeRange } = withTimeRange(search);

  const explorerSearch: LogsExplorerSearch = {
    q: search.q,
    levels: search.levels,
    services: service,
    attributes: search.attributes,
    traceId: search.traceId,
    showVolume: search.showVolume,
  };

  return (
    <ExploreShell title="Logs" timeRange={timeRange} refresh={search.refresh ?? ""} {...controls}>
      <LocalTelemetryGate>
        <LogsExplorer
          repo={repo}
          refresh={search.refresh ?? ""}
          timeRange={timeRange}
          search={explorerSearch}
          environment={environment}
          persistentFilters={
            <ExplorePersistentFilters
              to="/logs"
              timeRange={timeRange}
              service={service}
              environment={environment}
            />
          }
          // oxlint-disable-next-line typescript/no-misused-promises -- Preserve the existing async callback and its promise result; the caller already controls its use.
          onSearchChange={({ services: _ignored, ...next }) =>
            navigate({
              to: "/logs",
              search: (prev) => ({ ...prev, ...next }),
              replace: true,
            })
          }
          // oxlint-disable-next-line typescript/no-misused-promises -- Preserve the existing async callback and its promise result; the caller already controls its use.
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
      </LocalTelemetryGate>
    </ExploreShell>
  );
}
