import type { TimeRange } from "@everr/ui/lib/time-range";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { withEnvironment } from "../../filters/environment";
import { countPersistentFilters } from "../../filters/ui/explore-global-filters";
import {
  listServiceIdentitiesOptions,
  tracesSearchInfiniteOptions,
} from "../data/options";
import type { TracesRepositoryLike } from "../data/repository";
import type { AttributeFilter, SpanStatusFilter } from "../data/schemas";
import { TraceFilters } from "./trace-filters";
import {
  type TraceLinkRenderProps,
  TraceResultsList,
} from "./trace-results-list";

export type { TraceLinkRenderProps };

// How many traces each infinite-query page fetches. Not user-tunable, so it
// lives here rather than in the URL search params.
const TRACES_PAGE_SIZE = 50;

export type TraceSearchValue = {
  namespace: string[];
  service: string[];
  name: string;
  minMs: number | undefined;
  maxMs: number | undefined;
  status: SpanStatusFilter;
  attributes: AttributeFilter[];
};

export type TracesSearchProps = {
  repo: TracesRepositoryLike;
  timeRange: TimeRange;
  refresh: string;
  search: TraceSearchValue;
  environment?: string[];
  // The top zone of the rail: Service and Environment. The host app supplies it,
  // because the two values are search params that the pages share.
  persistentFilters?: ReactNode;
  onSearchChange: (patch: Partial<TraceSearchValue>) => void;
  renderTraceLink: (props: TraceLinkRenderProps) => ReactNode;
};

export function TracesSearch({
  repo,
  timeRange,
  refresh,
  search,
  environment = [],
  persistentFilters,
  onSearchChange,
  renderTraceLink,
}: TracesSearchProps) {
  const identitiesQuery = useQuery(
    listServiceIdentitiesOptions(repo, { timeRange, refresh }),
  );
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
    error,
    refetch,
  } = useInfiniteQuery({
    ...tracesSearchInfiniteOptions({
      repo,
      timeRange,
      refresh,
      namespace: search.namespace,
      service: search.service,
      name: search.name,
      minMs: search.minMs,
      maxMs: search.maxMs,
      status: search.status,
      attributes: withEnvironment(search.attributes, environment),
      limit: TRACES_PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(
    () => (data?.pages ?? []).flat().filter((row) => row != null),
    [data],
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <TraceFilters
            repo={repo}
            timeRange={timeRange}
            value={{
              namespace: search.namespace,
              name: search.name,
              minMs: search.minMs,
              maxMs: search.maxMs,
              status: search.status,
              attributes: search.attributes,
            }}
            identities={identitiesQuery.data ?? []}
            persistentFilters={persistentFilters}
            persistentFilterCount={countPersistentFilters(
              search.service,
              environment,
            )}
            onChange={onSearchChange}
          />
          <main className="flex min-h-0 min-w-0 flex-col">
            <TraceResultsList
              rows={rows}
              isPending={isPending}
              isError={isError}
              error={error}
              refetch={refetch}
              hasMore={hasNextPage}
              isLoadingMore={isFetchingNextPage}
              renderTraceLink={renderTraceLink}
              onLoadMore={() => fetchNextPage()}
              onClearFilters={() =>
                // The same effect as "Clear page filters" in the rail. Service
                // and Environment keep their values.
                onSearchChange({
                  namespace: [],
                  name: "",
                  minMs: undefined,
                  maxMs: undefined,
                  status: "all",
                  attributes: [],
                })
              }
            />
          </main>
        </div>
      </section>
    </div>
  );
}
