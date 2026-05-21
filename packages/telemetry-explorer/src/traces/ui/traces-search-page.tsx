import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  listServiceIdentitiesOptions,
  tracesSearchOptions,
} from "../data/options";
import type { TracesRepositoryLike } from "../data/repository";
import type { SpanStatusFilter } from "../data/schemas";
import type { TimeRange } from "../time-range";
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
  const tracesQuery = useQuery(
    tracesSearchOptions({
      repo,
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
        onChange={onSearchChange}
      />
      <TraceResultsList
        query={tracesQuery}
        limit={search.limit}
        renderTraceLink={renderTraceLink}
        onLoadMore={() =>
          onSearchChange({ limit: Math.min(search.limit + 50, 500) })
        }
        onClearFilters={() =>
          onSearchChange({
            namespace: [],
            service: [],
            name: "",
            minMs: undefined,
            maxMs: undefined,
            status: "all",
            limit: 50,
          })
        }
      />
    </div>
  );
}
