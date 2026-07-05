import { TraceSearchParamsSchema, TracesSearch } from "@everr/telemetry-explorer/traces";
import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  createFileRoute,
  Link,
  Outlet,
  stripSearchParams,
  useSearch,
} from "@tanstack/react-router";
import { remoteTracesRepo } from "@/data/traces/remote-repo";
import { ExploreSearchShape } from "@/lib/explore-search";

// service/environment live in the shared _explore topbar but must also be in
// the child schema so the leaf route's validateSearch doesn't strip them.
const RouteSearchSchema = TraceSearchParamsSchema.extend(ExploreSearchShape);

// Keep the URL clean: the schema fills in defaults (empty arrays, "all", …)
// during validation, so without this every navigation would serialize them
// back into the query string.
const defaultSearch = RouteSearchSchema.parse({});

export const Route = createFileRoute("/_authenticated/_dashboard/_explore/traces")({
  staticData: { breadcrumb: "Traces" },
  head: () => ({ meta: [{ title: "Everr - Traces" }] }),
  validateSearch: RouteSearchSchema,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
  component: TracesRoute,
});

function TracesRoute() {
  // Always keep the list mounted in the same position so opening/closing the
  // modal never remounts it (a remount resets the virtualized list and re-runs
  // queries, which shows up as a flash on close).
  return (
    <>
      <TracesSearchPage />
      <Outlet />
    </>
  );
}

function TracesSearchPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeRange } = withTimeRange(search);
  const { service = [], environment = [] } = useSearch({
    from: "/_authenticated/_dashboard/_explore",
  });

  return (
    <TracesSearch
      repo={remoteTracesRepo}
      timeRange={timeRange}
      refresh={search.refresh ?? "off"}
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
        // Push a history entry per change so Back undoes filter changes one at a
        // time (including Clear all, which routes through this same handler).
        void navigate({
          search: (prev) => ({ ...prev, ...patch }),
        })
      }
      renderTraceLink={({ traceId, start, end, className, children }) => (
        <Link
          to="/traces/$traceId/modal"
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
