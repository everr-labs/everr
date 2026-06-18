import {
  TraceDetail,
  type TraceDetailParams,
  TraceDetailParamsSchema,
  type TraceSearchParams,
  TraceSearchParamsSchema,
  TracesRepository,
  TracesSearch,
  toTraceListSearch,
} from "@everr/telemetry-explorer/traces";
import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  Link,
  Outlet,
  useMatch,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import {
  DetailRouteDialog,
  useDetailRouteDialogClose,
} from "@/components/detail-route-dialog";
import { ExploreSearchShape } from "../explore/explore-search";
import { ExploreShell } from "../explore/explore-shell";
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
  const traceDetailMatch = useMatch({
    from: "/authenticated/traces/$traceId",
    shouldThrow: false,
  });
  const search = useSearch({ strict: false }) as TraceDetailParams;
  const navigate = useNavigate();

  // Always keep the list mounted in the same position so opening/closing the
  // modal never remounts it (a remount resets the virtualized list and re-runs
  // queries, which shows up as a flash on close).
  return (
    <>
      <TracesListView />
      {traceDetailMatch && (
        <DetailRouteDialog
          title="Trace detail"
          onClose={() =>
            navigate({ to: "/traces", search: toTraceListSearch(search) })
          }
        >
          <Outlet />
        </DetailRouteDialog>
      )}
    </>
  );
}

function TracesListView() {
  const search = useSearch({ strict: false }) as TraceSearchParams & {
    service?: string[];
    environment?: string[];
  };
  const navigate = useNavigate();
  const { timeRange } = withTimeRange(search);
  const refresh = search.refresh ?? "";
  const service = search.service ?? [];
  const environment = search.environment ?? [];

  return (
    <ExploreShell
      title="Traces"
      timeRange={timeRange}
      refresh={refresh}
      service={service}
      environment={environment}
      onTimeRangeChange={(range) =>
        navigate({
          to: "/traces",
          search: (prev) => ({ ...prev, from: range.from, to: range.to }),
          replace: true,
        })
      }
      onRefreshChange={(value) =>
        navigate({
          to: "/traces",
          search: (prev) => ({ ...prev, refresh: value || undefined }),
          replace: true,
        })
      }
      onServiceChange={(values) =>
        navigate({
          to: "/traces",
          search: (prev) => ({ ...prev, service: values }),
          replace: true,
        })
      }
      onEnvironmentChange={(values) =>
        navigate({
          to: "/traces",
          search: (prev) => ({ ...prev, environment: values }),
          replace: true,
        })
      }
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
          hideSharedFilters
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
  // Inside the modal, ask the dialog to close through the route owner so the
  // dialog stays open until navigation removes it.
  const closeDialog = useDetailRouteDialogClose();
  return (
    <LocalTelemetryGate>
      <TraceDetail
        repo={localTracesRepo}
        traceId={traceId}
        search={search}
        onClose={() => {
          if (closeDialog) {
            closeDialog();
            return;
          }
          navigate({ to: "/traces", search: toTraceListSearch(search) });
        }}
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
  );
}
