import { ExploreSearchShape } from "@everr/telemetry-explorer/filters";
import {
  type TraceDetailParams,
  TraceDetailParamsSchema,
  TraceExplorer,
  type TraceSearchParams,
  TraceSearchParamsSchema,
  TracesRepository,
  TracesSearch,
  toTraceListSearch,
} from "@everr/telemetry-explorer/traces";
import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { PageTitleBar } from "../app-shell/title-bar";
import { ExploreShell } from "../explore/explore-shell";
import { ExplorePersistentFilters } from "../explore/persistent-filters";
import { useExploreControls } from "../explore/use-explore-controls";
import { LocalTelemetryGate } from "../local-telemetry/collector-status";
import { localSqlClient } from "../logs/local-sql-client";

// service/environment live in the shared Explore topbar but must also be in the
// route schemas so the leaf route's validateSearch doesn't strip them.
export const TracesListSearchSchema =
  TraceSearchParamsSchema.extend(ExploreSearchShape);
export const TraceDetailSearchSchema =
  TraceDetailParamsSchema.extend(ExploreSearchShape);

const localTracesRepo = new TracesRepository(localSqlClient);

export function TracesPage() {
  const search = useSearch({ strict: false }) as TraceSearchParams & {
    service?: string[];
    environment?: string[];
  };
  const navigate = useNavigate();
  const controls = useExploreControls("/traces");
  const { timeRange } = withTimeRange(search);
  const refresh = search.refresh ?? "";
  const service = search.service ?? [];
  const environment = search.environment ?? [];

  return (
    <ExploreShell
      title="Traces"
      timeRange={timeRange}
      refresh={refresh}
      {...controls}
    >
      <LocalTelemetryGate>
        <TracesSearch
          repo={localTracesRepo}
          timeRange={timeRange}
          refresh={refresh}
          search={{
            namespace: search.namespace,
            service,
            name: search.name,
            minMs: search.minMs,
            maxMs: search.maxMs,
            status: search.status,
            attributes: search.attributes,
          }}
          environment={environment}
          persistentFilters={
            <ExplorePersistentFilters
              to="/traces"
              timeRange={timeRange}
              service={service}
              environment={environment}
            />
          }
          onSearchChange={(patch) =>
            navigate({
              to: "/traces",
              search: (prev) => ({ ...prev, ...patch }),
              replace: true,
            })
          }
          renderTraceLink={({ traceId, start, end, className, children }) => (
            <Link
              to="/traces/$traceId"
              params={{ traceId }}
              search={(prev) => ({ ...prev, start, end })}
              className={className}
            >
              {children}
            </Link>
          )}
        />
      </LocalTelemetryGate>
    </ExploreShell>
  );
}

export function TraceDetailPage() {
  const { traceId } = useParams({ strict: false }) as { traceId: string };
  const search = useSearch({ strict: false }) as TraceDetailParams;
  const navigate = useNavigate();
  return (
    <>
      <PageTitleBar title="Trace" />
      <LocalTelemetryGate>
        <TraceExplorer
          repo={localTracesRepo}
          traceId={traceId}
          search={search}
          onBack={() =>
            navigate({ to: "/traces", search: toTraceListSearch(search) })
          }
          onSpanChange={(spanId) =>
            navigate({
              to: "/traces/$traceId",
              params: { traceId },
              search: (prev) => ({ ...prev, span: spanId }),
              replace: true,
            })
          }
        />
      </LocalTelemetryGate>
    </>
  );
}
