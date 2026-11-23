import { ExploreGlobalFilters } from "../../filters";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { ShellSearchSchema } from "../../shell/route";
import { useRouteSearch, useSearchPatch } from "../../shell/search-io";
import { useExploreBackend } from "../backend";

/**
 * The top zone of the Explore filter rail.
 *
 * Each Explore page puts this component in its rail. The component reads and
 * writes the `service` and `environment` search params, which are on the shell
 * layout route. The selection therefore stays set when the user moves between
 * Traces, Logs, Errors and Metrics. See the notes on the retain and strip
 * middleware in `shellRouteOptions`.
 */
export function ExplorePersistentFilters() {
  const { repos } = useExploreBackend();
  const search = useRouteSearch(ShellSearchSchema);
  const { service = [], environment = [] } = search;
  const { timeRange } = withTimeRange(search);

  // The patch has no destination route, so it keeps the user on the current
  // path. A navigate that is bound to a route sends every search change to
  // that route.
  const patchSearch = useSearchPatch();

  // Each change adds one history entry. Back then moves through the filter
  // states one change at a time, as it does for the page filters.
  return (
    <ExploreGlobalFilters
      logsRepo={repos.logs}
      tracesRepo={repos.traces}
      metricsRepo={repos.metrics}
      timeRange={timeRange}
      service={service}
      environment={environment}
      onServiceChange={(next) => patchSearch({ service: next })}
      onEnvironmentChange={(next) => patchSearch({ environment: next })}
    />
  );
}
