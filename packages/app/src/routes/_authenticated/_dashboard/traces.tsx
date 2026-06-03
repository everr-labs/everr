import {
  TraceSearchParamsSchema,
  TracesSearch,
} from "@everr/telemetry-explorer/traces";
import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  createFileRoute,
  Link,
  Outlet,
  stripSearchParams,
  useMatch,
} from "@tanstack/react-router";
import { remoteTracesRepo } from "@/data/traces/remote-repo";

// Keep the URL clean: the schema fills in defaults (empty arrays, "all",
// limit, …) during validation, so without this every navigation would
// serialize them back into the query string.
const defaultSearch = TraceSearchParamsSchema.parse({});

export const Route = createFileRoute("/_authenticated/_dashboard/traces")({
  staticData: { breadcrumb: "Traces", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Traces" }] }),
  validateSearch: TraceSearchParamsSchema,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
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
        attributes: search.attributes,
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
