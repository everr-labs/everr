import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  listServiceIdentitiesOptions,
  tracesSearchOptions,
} from "@/data/traces/options";
import { withTimeRange } from "@/lib/time-range";
import { TraceFilters } from "./trace-filters";
import { TraceResultsList } from "./trace-results-list";

const route = getRouteApi("/_authenticated/_dashboard/traces");

export function TracesSearchPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const { timeRange } = withTimeRange(search);

  const refresh = search.refresh ?? "";
  const identitiesQuery = useQuery(
    listServiceIdentitiesOptions(timeRange, refresh),
  );
  const tracesQuery = useQuery(
    tracesSearchOptions({
      timeRange,
      refresh,
      namespace: search.namespace,
      service: search.service,
      name: search.name,
      minMs: search.minMs,
      maxMs: search.maxMs,
      status: search.status,
      limit: search.limit,
    }),
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <TraceFilters
        value={{
          namespace: search.namespace,
          service: search.service,
          name: search.name,
          minMs: search.minMs,
          maxMs: search.maxMs,
          status: search.status,
        }}
        identities={identitiesQuery.data ?? []}
        onChange={(patch) =>
          navigate({
            search: (prev) => ({ ...prev, ...patch }),
            replace: true,
          })
        }
      />
      <TraceResultsList
        query={tracesQuery}
        limit={search.limit}
        onLoadMore={() =>
          navigate({
            search: (prev) => ({
              ...prev,
              limit: Math.min((prev.limit ?? 50) + 50, 500),
            }),
            replace: true,
          })
        }
        onClearFilters={() =>
          navigate({
            search: () => ({
              namespace: [],
              service: [],
              name: "",
              status: "all",
              limit: 50,
            }),
            replace: true,
          })
        }
      />
    </div>
  );
}
