import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import type { TimeRange } from "@everr/ui/lib/time-range";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  listServiceIdentitiesOptions,
  tracesSearchInfiniteOptions,
} from "../data/options";
import type { TracesRepositoryLike } from "../data/repository";
import { PAGE_SIZE, type SpanStatusFilter } from "../data/schemas";
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
  const tracesQuery = useInfiniteQuery({
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
      limit: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });

  const traces = useMemo(
    () => (tracesQuery.data?.pages ?? []).flatMap((page) => page.traces),
    [tracesQuery.data],
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b bg-muted/10 px-3 py-2">
          <TraceSearchForm
            value={search.name}
            onChange={(name) => onSearchChange({ name })}
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
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
          <main className="min-h-0 min-w-0">
            <div className="flex h-full min-h-0 flex-col p-4">
              <TraceResultsList
                traces={traces}
                isPending={tracesQuery.isPending}
                isError={tracesQuery.isError}
                error={tracesQuery.error}
                onRetry={() => tracesQuery.refetch()}
                hasNextPage={tracesQuery.hasNextPage}
                isFetchingNextPage={tracesQuery.isFetchingNextPage}
                onLoadMore={() => tracesQuery.fetchNextPage()}
                renderTraceLink={renderTraceLink}
                onClearFilters={() =>
                  onSearchChange({
                    namespace: [],
                    service: [],
                    name: "",
                    minMs: undefined,
                    maxMs: undefined,
                    status: "all",
                  })
                }
              />
            </div>
          </main>
        </div>
      </section>
    </div>
  );
}

function TraceSearchForm({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        onChange(draft.trim());
      }}
    >
      <label htmlFor="traces-search" className="sr-only">
        Search traces
      </label>
      <InputGroup className="h-8">
        <InputGroupInput
          id="traces-search"
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Search span names"
        />
        <InputGroupAddon align="inline-start">
          <Search />
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          {value ? (
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => {
                setDraft("");
                onChange("");
              }}
            >
              <X />
            </InputGroupButton>
          ) : null}
          <InputGroupButton type="submit" variant="secondary">
            Search
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
