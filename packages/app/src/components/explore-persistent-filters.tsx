import { ExploreGlobalFilters } from "@everr/telemetry-explorer/filters";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { remoteRepo } from "@/data/logs-explorer/remote-repo";
import { remoteTracesRepo } from "@/data/traces/remote-repo";

/**
 * The top zone of the Explore filter rail.
 *
 * Each Explore page puts this component in its rail. The component reads and
 * writes the `service` and `environment` search params, which are on the
 * `_dashboard` layout. The selection therefore stays set when the user moves
 * between Traces, Logs and Errors. See the notes on the retain and strip
 * middleware in `_dashboard.tsx`.
 */
export function ExplorePersistentFilters() {
  const { service = [], environment = [] } = useSearch({
    from: "/_authenticated/_dashboard/_explore",
  });
  const dashSearch = useSearch({ from: "/_authenticated/_dashboard" });
  const { timeRange } = withTimeRange(dashSearch);

  // useNavigate() with no route keeps the user on the current path. A navigate
  // that is bound to a route sends every search change to that route.
  const navigate = useNavigate();

  // Each change adds one history entry. Back then moves through the filter
  // states one change at a time, as it does for the page filters.
  const onServiceChange = (next: string[]) =>
    navigate({
      // @ts-expect-error -- the navigate has no route, so useNavigate() cannot infer the search params
      search: (prev: Record<string, unknown>) => ({ ...prev, service: next }),
    });
  const onEnvironmentChange = (next: string[]) =>
    navigate({
      // @ts-expect-error -- the navigate has no route, so useNavigate() cannot infer the search params
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        environment: next,
      }),
    });

  return (
    <ExploreGlobalFilters
      logsRepo={remoteRepo}
      tracesRepo={remoteTracesRepo}
      timeRange={timeRange}
      service={service}
      environment={environment}
      onServiceChange={onServiceChange}
      onEnvironmentChange={onEnvironmentChange}
    />
  );
}
