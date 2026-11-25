import { CLEAR_METRIC, MetricsExplorer, MetricsSearchSchema } from "../../metrics";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { Link } from "@tanstack/react-router";
import { useRouteSearch, useSearchPatch } from "../../shell/search-io";
import { useLastOpened } from "../../shell/use-last-opened";
import { useExploreBackend } from "../backend";
import { ExplorePersistentFilters } from "./persistent-filters";

export function MetricsRoute() {
  const { repos } = useExploreBackend();
  const search = useRouteSearch(MetricsSearchSchema);
  const patchSearch = useSearchPatch();
  const { timeRange, from, to } = withTimeRange(search);
  const { service = [], environment = [] } = search;
  const lastOpenedMetric = useLastOpened(
    search.metric && search.metricType ? `${search.metricType}:${search.metric}` : undefined,
  );

  return (
    <MetricsExplorer
      repo={repos.metrics}
      timeRange={timeRange}
      search={search}
      service={service}
      environment={environment}
      persistentFilters={<ExplorePersistentFilters />}
      onSearchChange={(patch) =>
        // One history entry per change, so Back undoes them one at a time.
        patchSearch(patch)
      }
      onTimeRangeSelect={(from, to) =>
        patchSearch({ from: from.toISOString(), to: to.toISOString() })
      }
      lastOpenedMetric={lastOpenedMetric}
      renderMetricLink={({ metric, type, className, children }) => (
        <Link
          to="/metrics"
          search={(prev) => ({ ...prev, ...CLEAR_METRIC, metric, metricType: type })}
          className={className}
        >
          {children}
        </Link>
      )}
      renderTraceLink={({ traceId, spanId, className, children }) => (
        <Link
          to="/traces/$traceId"
          params={{ traceId }}
          search={spanId ? { span: spanId } : {}}
          className={className}
        >
          {children}
        </Link>
      )}
      renderLogsLink={({ traceId, className, children }) => (
        <Link to="/logs" search={{ traceId, from, to }} className={className}>
          {children}
        </Link>
      )}
      renderCatalogLink={({ className, children }) => (
        <Link to="/metrics" search={(prev) => ({ ...prev, ...CLEAR_METRIC })} className={className}>
          {children}
        </Link>
      )}
    />
  );
}
