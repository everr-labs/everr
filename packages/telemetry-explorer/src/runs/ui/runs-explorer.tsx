import type { TimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { FolderGit2 } from "lucide-react";
import { useMemo } from "react";
import { ExploreFilterPill } from "../../filters/ui/explore-filter-pill";
import { FilterSearchBar } from "../../filters/ui/filter-search-bar";
import {
  runsExplorerInfiniteOptions,
  runsFilterOptions,
  runsHistogramOptions,
} from "../data/options";
import type { RunsRepositoryLike } from "../data/repository";
import {
  DEFAULT_RUNS_HISTOGRAM_BUCKETS,
  DEFAULT_RUNS_PAGE_SIZE,
  type RunListItem,
  type RunStatusFilter,
} from "../schemas";
import { RunsFilters } from "./runs-filters";
import { RunsHistogram } from "./runs-histogram";
import { type RenderRunLink, type RenderRunRowActions, RunsResultsList } from "./runs-results-list";

export interface RunsExplorerSearch {
  runId?: string;
  repos: string[];
  branches: string[];
  conclusions: RunStatusFilter[];
  workflowNames: string[];
  onlyMine: boolean;
  showVolume: boolean;
}

export interface RunsExplorerProps {
  repo: RunsRepositoryLike;
  timeRange: TimeRange;
  search: RunsExplorerSearch;
  onSearchChange: (patch: Partial<RunsExplorerSearch>) => void;
  onTimeRangeSelect: (from: Date, to: Date) => void;
  /** Render the "Your runs" toggle in the sidebar. */
  showMineFilter?: boolean;
  renderRunLink: RenderRunLink;
  renderRowActions?: RenderRunRowActions;
}

export function RunsExplorer({
  repo,
  timeRange,
  search,
  onSearchChange,
  onTimeRangeSelect,
  showMineFilter = false,
  renderRunLink,
  renderRowActions,
}: RunsExplorerProps) {
  const { runId, repos, branches, conclusions, workflowNames, onlyMine, showVolume } = search;

  const filterInput = {
    timeRange,
    repos,
    branches,
    conclusions,
    workflowNames,
    runId: runId || undefined,
    onlyMine,
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
    ...runsExplorerInfiniteOptions(repo, {
      ...filterInput,
      limit: DEFAULT_RUNS_PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });

  const { data: histogram = [], isPending: isHistogramPending } = useQuery({
    ...runsHistogramOptions(repo, {
      ...filterInput,
      histogramBuckets: DEFAULT_RUNS_HISTOGRAM_BUCKETS,
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
        {/* Repository sits in the topbar — same slot (and h-11 height) as the
            Service/Environment filter bar on the logs/traces/errors explorers —
            rather than the sidebar. */}
        <div className="flex h-11 shrink-0 items-center gap-1.5 border-b bg-muted/10 px-3">
          <ExploreFilterPill
            label="Repository"
            icon={FolderGit2}
            values={repos}
            onChange={(next) => onSearchChange({ repos: next })}
            options={{
              ...runsFilterOptions(repo, { timeRange }),
              select: (data) => data.repos,
            }}
            placeholder="All repositories"
            searchPlaceholder="Search repositories..."
            countNoun="repositories"
          />
        </div>

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
            repo={repo}
            timeRange={timeRange}
            value={{ branches, conclusions, workflowNames, onlyMine }}
            showMineFilter={showMineFilter}
            onChange={onSearchChange}
          />

          <main className="min-h-0 min-w-0">
            <div className="flex h-full min-h-0 flex-col">
              <RunsHistogram
                buckets={histogram}
                isPending={isHistogramPending}
                showVolume={showVolume}
                onRangeSelect={onTimeRangeSelect}
                onShowVolumeChange={(show) => onSearchChange({ showVolume: show })}
              />

              <div className="flex min-h-0 flex-1 flex-col">
                <RunsResultsList
                  runs={runs}
                  totalCount={totalCount}
                  isPending={isPending}
                  isError={isError}
                  error={error}
                  refetch={() => void refetch()}
                  hasMore={hasNextPage}
                  isLoadingMore={isFetchingNextPage}
                  onLoadMore={() => void fetchNextPage()}
                  onClearFilters={clearFilters}
                  renderRunLink={renderRunLink}
                  renderRowActions={renderRowActions}
                />
              </div>
            </div>
          </main>
        </div>
      </section>
    </div>
  );
}
