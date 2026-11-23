import {
  TraceDetailParamsSchema,
  TraceExplorer,
  TracesSearch,
  toTraceListSearch,
} from "../../traces";
import { Button } from "@everr/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@everr/ui/components/empty";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { type ErrorComponentProps, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useRouteParam, useRouteSearch, useSearchPatch } from "../../shell/search-io";
import { useExploreBackend } from "../backend";
import { tracesRoute } from "../routes";
import { ExplorePersistentFilters } from "./persistent-filters";

export function TracesRoute() {
  const { repos } = useExploreBackend();
  const search = useRouteSearch(tracesRoute.validateSearch);
  const patchSearch = useSearchPatch();
  const { timeRange } = withTimeRange(search);
  const { service = [], environment = [] } = search;

  return (
    <TracesSearch
      repo={repos.traces}
      timeRange={timeRange}
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
      persistentFilters={<ExplorePersistentFilters />}
      onSearchChange={(patch) =>
        // Push a history entry per change so Back undoes filter changes one at a
        // time (including Clear all, which routes through this same handler).
        patchSearch(patch)
      }
      renderTraceLink={({ traceId, className, children }) => (
        <Link to="/traces/$traceId" params={{ traceId }} search className={className}>
          {children}
        </Link>
      )}
    />
  );
}

export function TraceDetailRoute() {
  const { repos } = useExploreBackend();
  const traceId = useRouteParam("traceId");
  const search = useRouteSearch(TraceDetailParamsSchema);
  const navigate = useNavigate();

  return (
    <TraceExplorer
      repo={repos.traces}
      traceId={traceId}
      search={search}
      onBack={() =>
        void navigate({
          to: "/traces",
          search: toTraceListSearch(search),
        })
      }
      onSpanChange={(spanId) =>
        void navigate({
          to: "/traces/$traceId",
          params: { traceId },
          search: (prev) => ({ ...prev, span: spanId }),
          replace: true,
          resetScroll: false,
        })
      }
    />
  );
}

export function TraceDetailError({ error }: ErrorComponentProps) {
  // The search itself can be what failed, so it goes on the link only when it is valid.
  const search = TraceDetailParamsSchema.safeParse(useSearch({ strict: false }));
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Failed to load trace</EmptyTitle>
        <EmptyDescription>
          {error instanceof Error ? error.message : String(error)}
        </EmptyDescription>
      </EmptyHeader>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link to="/traces" search={search.success ? toTraceListSearch(search.data) : {}} />}
      >
        Back to traces
      </Button>
    </Empty>
  );
}
