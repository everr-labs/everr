import {
  CLEAR_METRIC,
  MetricsExplorer,
  MetricsSearchSchema,
} from "@everr/telemetry-explorer/metrics";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { createFileRoute, Link, stripSearchParams, useSearch } from "@tanstack/react-router";
import { ExplorePersistentFilters } from "#app/components/explore-persistent-filters.tsx";
import { remoteMetricsRepo } from "#app/data/metrics/remote-repo.ts";

// Keep the URL clean: without this, every navigation would write the schema
// defaults (empty arrays and strings) back into the query string.
const defaultSearch = MetricsSearchSchema.parse({});

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/metrics",
)({
  staticData: { breadcrumb: "Metrics" },
  validateSearch: MetricsSearchSchema,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
  head: () => ({ meta: [{ title: "Everr - Metrics" }] }),
  component: MetricsExplorerPage,
});

function MetricsExplorerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeRange, from, to } = withTimeRange(search);
  const { service = [], environment = [] } = useSearch({
    from: "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore",
  });

  return (
    <MetricsExplorer
      repo={remoteMetricsRepo}
      timeRange={timeRange}
      search={search}
      service={service}
      environment={environment}
      persistentFilters={<ExplorePersistentFilters />}
      onSearchChange={(patch) =>
        // One history entry per change, so Back undoes them one at a time.
        void navigate({ search: (prev) => ({ ...prev, ...patch }) })
      }
      onTimeRangeSelect={(from, to) =>
        void navigate({
          search: (prev) => ({ ...prev, from: from.toISOString(), to: to.toISOString() }),
        })
      }
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
