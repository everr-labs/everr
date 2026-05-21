import {
  TraceSearchParamsSchema,
  TracesSearch,
  withTimeRange,
} from "@everr/telemetry-explorer/traces";
import {
  createFileRoute,
  Link,
  Outlet,
  useMatch,
} from "@tanstack/react-router";
import { remoteTracesRepo } from "@/data/traces/remote-repo";

export const Route = createFileRoute("/_authenticated/_dashboard/traces")({
  staticData: { breadcrumb: "Traces", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Traces" }] }),
  validateSearch: TraceSearchParamsSchema,
  component: TracesRoute,
});

function TracesRoute() {
  const traceDetailMatch = useMatch({
    from: "/_authenticated/_dashboard/traces/$traceId",
    shouldThrow: false,
  });
  return traceDetailMatch ? <Outlet /> : <TracesSearchPage />;
}

function TracesSearchPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeRange } = withTimeRange(search);

  return (
    <TracesSearch
      repo={remoteTracesRepo}
      timeRange={timeRange}
      refresh={search.refresh ?? ""}
      search={{
        namespace: search.namespace,
        service: search.service,
        name: search.name,
        minMs: search.minMs,
        maxMs: search.maxMs,
        status: search.status,
        limit: search.limit,
      }}
      onSearchChange={(patch) =>
        navigate({
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
  );
}
