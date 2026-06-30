import { FilterSearchBar } from "@everr/telemetry-explorer/filters";
import type { TimeRange } from "@everr/ui/lib/time-range";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import {
  runsHistogramOptions,
  runsListInfiniteOptions,
} from "@/data/runs-list/options";
import type { RunListItem } from "@/data/runs-list/schemas";
import type { RunStatusFilter } from "./run-conclusion-meta";
import { RunsFilters } from "./runs-filters";
import { RunsHistogram } from "./runs-histogram";
import { RunsResultsList } from "./runs-results-list";

// How many runs each infinite page fetches, and how many histogram buckets to
// request. Not user-tunable, so they live here rather than in the URL.
const PAGE_SIZE = 50;
const HISTOGRAM_BUCKETS = 80;

export interface RunsExplorerSearch {
  runId?: string;
  repos: string[];
  branches: string[];
  conclusions: RunStatusFilter[];
  workflowNames: string[];
  showVolume: boolean;
}

export interface RunsExplorerProps {
  timeRange: TimeRange;
  search: RunsExplorerSearch;
  onSearchChange: (patch: Partial<RunsExplorerSearch>) => void;
  onTimeRangeSelect: (from: Date, to: Date) => void;
}

export function RunsExplorer({
  timeRange,
  search,
  onSearchChange,
  onTimeRangeSelect,
}: RunsExplorerProps) {
  const { runId, repos, branches, conclusions, workflowNames, showVolume } =
    search;

  const filterInput = {
    timeRange,
    repos,
    branches,
    conclusions,
    workflowNames,
    runId: runId || undefined,
  };

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
    ...runsListInfiniteOptions({ ...filterInput, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const { data: histogram = [], isPending: isHistogramPending } = useQuery({
    ...runsHistogramOptions({
      ...filterInput,
      histogramBuckets: HISTOGRAM_BUCKETS,
    }),
    enabled: showVolume,
    placeholderData: keepPreviousData,
  });

  // Offset pages can overlap when a realtime event reorders the list between
  // fetches, so dedupe by traceId to avoid duplicate Virtuoso keys.
  const runs = useMemo(() => {
    const seen = new Set<string>();
    const flattened: RunListItem[] = [];
    for (const page of data?.pages ?? []) {
      for (const run of page?.runs ?? []) {
        if (seen.has(run.traceId)) continue;
        seen.add(run.traceId);
        flattened.push(run);
      }
    }
    return flattened;
  }, [data]);
  const totalCount = data?.pages?.[0]?.totalCount;

  const clearFilters = () =>
    onSearchChange({
      runId: undefined,
      repos: [],
      branches: [],
      conclusions: [],
      workflowNames: [],
    });

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b bg-muted/10 px-3 py-2">
          <FilterSearchBar
            id="runs-search"
            label="Search runs by ID"
            value={runId ?? ""}
            onChange={(value) => onSearchChange({ runId: value || undefined })}
            placeholder="Search by run ID"
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <RunsFilters
            timeRange={timeRange}
            value={{ repos, branches, conclusions, workflowNames }}
            onChange={onSearchChange}
          />

          <main className="min-h-0 min-w-0">
            <div className="flex h-full min-h-0 flex-col">
              <RunsHistogram
                buckets={histogram}
                isPending={isHistogramPending}
                showVolume={showVolume}
                onRangeSelect={onTimeRangeSelect}
                onShowVolumeChange={(show) =>
                  onSearchChange({ showVolume: show })
                }
              />

              <div className="flex min-h-0 flex-1 flex-col">
                <RunsResultsList
                  runs={runs}
                  totalCount={totalCount}
                  isPending={isPending}
                  isError={isError}
                  error={error as Error | null}
                  refetch={refetch}
                  hasMore={hasNextPage}
                  isLoadingMore={isFetchingNextPage}
                  onLoadMore={fetchNextPage}
                  onClearFilters={clearFilters}
                />
              </div>
            </div>
          </main>
        </div>
      </section>
    </div>
  );
}
