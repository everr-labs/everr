import type { TimeRange } from "@everr/ui/lib/time-range";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
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

export type TraceSearchValue = {
  namespace: string[];
  service: string[];
  name: string;
  minMs: number | undefined;
  maxMs: number | undefined;
  status: SpanStatusFilter;
  attributes: AttributeFilter[];
  limit: number;
};

export type TracesSearchProps = {
  repo: TracesRepositoryLike;
  timeRange: TimeRange;
  refresh: string;
  search: TraceSearchValue;
  onSearchChange: (patch: Partial<TraceSearchValue>) => void;
  renderTraceLink: (props: TraceLinkRenderProps) => ReactNode;
};

export function TracesSearch({
  repo,
  timeRange,
  refresh,
  search,
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
      attributes: search.attributes,
      limit: search.limit,
    }),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(
    () => (data?.pages ?? []).flat().filter((row) => row != null),
    [data],
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <TraceFilters
        repo={repo}
        timeRange={timeRange}
        value={{
          namespace: search.namespace,
          service: search.service,
          name: search.name,
          minMs: search.minMs,
          maxMs: search.maxMs,
          status: search.status,
          attributes: search.attributes,
        }}
        identities={identitiesQuery.data ?? []}
        onChange={onSearchChange}
      />
      <main className="flex min-h-0 min-w-0 flex-col p-4">
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
            onSearchChange({
              namespace: [],
              service: [],
              name: "",
              minMs: undefined,
              maxMs: undefined,
              status: "all",
              attributes: [],
              limit: 50,
            })
          }
        />
      </main>
    </div>
  );
}
