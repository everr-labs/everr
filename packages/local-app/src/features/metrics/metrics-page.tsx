import {
  CLEAR_METRIC,
  MetricsExplorer,
  MetricsRepository,
  MetricsSearchSchema,
} from "@everr/telemetry-explorer/metrics";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ExploreShell } from "../explore/explore-shell";
import { ExplorePersistentFilters } from "../explore/persistent-filters";
import { useExploreControls } from "../explore/use-explore-controls";
import { LocalTelemetryGate } from "../local-telemetry/collector-status";
import { localSqlClient } from "../logs/local-sql-client";

// The local collector writes the same metrics_* tables as the cloud.
const localMetricsRepo = new MetricsRepository(localSqlClient);

export function MetricsPage() {
  const search = MetricsSearchSchema.parse(useSearch({ strict: false }));
  const navigate = useNavigate();
  const controls = useExploreControls("/metrics");
  const { timeRange, from, to } = withTimeRange(search);
  const refresh = search.refresh ?? "";
  const service = search.service ?? [];
  const environment = search.environment ?? [];

  return (
    <ExploreShell title="Metrics" timeRange={timeRange} refresh={refresh} {...controls}>
      <LocalTelemetryGate>
        <MetricsExplorer
          repo={localMetricsRepo}
          timeRange={timeRange}
          search={search}
          service={service}
          environment={environment}
          persistentFilters={
            <ExplorePersistentFilters
              to="/metrics"
              timeRange={timeRange}
              service={service}
              environment={environment}
            />
          }
          onSearchChange={(patch) =>
            void navigate({
              to: "/metrics",
              search: (prev) => ({ ...prev, ...patch }),
              replace: true,
            })
          }
          onTimeRangeSelect={(start, end) =>
            void navigate({
              to: "/metrics",
              search: (prev) => ({ ...prev, from: start.toISOString(), to: end.toISOString() }),
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
          renderCatalogLink={({ className, children }) => (
            <Link
              to="/metrics"
              search={(prev) => ({ ...prev, ...CLEAR_METRIC })}
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
        />
      </LocalTelemetryGate>
    </ExploreShell>
  );
}
