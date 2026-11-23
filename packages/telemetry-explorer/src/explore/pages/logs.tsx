import { LogsExplorer, type LogsExplorerSearch, LogsSearchSchema } from "../../logs";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useRouteSearch, useSearchPatch } from "../../shell/search-io";
import { useExploreBackend } from "../backend";
import { ExplorePersistentFilters } from "./persistent-filters";

export function LogsRoute() {
  const { repos, ciRunLinks } = useExploreBackend();
  const search = useRouteSearch(LogsSearchSchema);
  const patchSearch = useSearchPatch();
  const { service = [], environment = [], showVolume, ...rest } = search;
  const { timeRange, ...filters } = withTimeRange(rest);

  const explorerSearch: LogsExplorerSearch = {
    q: filters.q,
    levels: filters.levels,
    services: service,
    attributes: filters.attributes,
    traceId: filters.traceId,
    showVolume,
  };

  return (
    <LogsExplorer
      repo={repos.logs}
      timeRange={timeRange}
      search={explorerSearch}
      environment={environment}
      persistentFilters={<ExplorePersistentFilters />}
      onSearchChange={({ services: _ignored, ...next }) =>
        // Push a history entry per change so Back undoes filter changes one at a
        // time.
        patchSearch(next)
      }
      onTimeRangeSelect={(from, to) =>
        patchSearch({ from: from.toISOString(), to: to.toISOString() })
      }
      resolveJobId={ciRunLinks?.resolveJobId}
      renderRunLink={ciRunLinks?.renderRunLink}
    />
  );
}
