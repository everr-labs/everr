import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { ReactNode } from "react";
import {
  logsTotalsOptions,
  logsExplorerInfiniteOptions,
  logsHistogramOptions,
} from "../data/options";
import type { LogExplorerRow, LogLevel } from "../schemas";
import type { TimeRange } from "../time-range";
import type { LogsRepositoryLike } from "../data/repository";
import { DEFAULT_HISTOGRAM_BUCKETS, PAGE_SIZE } from "./log-level-meta";
import { LogHistogram } from "./log-histogram";
import { LogFiltersBar } from "./log-filters";
import { LogRow } from "./log-row";
import { LogInspectorPanel } from "./log-inspector";

export interface LogsExplorerSearch {
  q?: string;
  levels: LogLevel[];
  services: string[];
  repos: string[];
  traceId?: string;
  showVolume: boolean;
}

export interface LogsExplorerProps {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  search: LogsExplorerSearch;
  onSearchChange: (next: LogsExplorerSearch) => void;
  onTimeRangeSelect?: (from: Date, to: Date) => void;
  renderRunLink?: (ctx: {
    traceId: string;
    jobId: string;
    stepNumber: string;
  }) => ReactNode;
  resolveJobId?: (input: {
    traceId: string;
    jobName: string;
  }) => string | undefined;
}

const VIRTUOSO_OVERSCAN_IDLE = { top: 400, bottom: 400 };
// Bumped while text is selected so the native browser selection survives scrolling.
const VIRTUOSO_OVERSCAN_SELECTING = { top: 10000, bottom: 10000 };

function computeRowKey(index: number, log: LogExplorerRow) {
  return `${log.id}:${index}`;
}

function LogStream({
  logs,
  selectedLogKey,
  totalCount,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onSelect,
}: {
  logs: LogExplorerRow[];
  selectedLogKey?: string;
  totalCount?: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onSelect: (log: LogExplorerRow, key: string) => void;
}) {
  const [isSelecting, setIsSelecting] = useState(false);

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      setIsSelecting(Boolean(selection && !selection.isCollapsed));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  const endReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) onLoadMore();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  const itemContent = useCallback(
    (index: number, log: LogExplorerRow) => {
      const rowKey = `${log.id}:${index}`;
      return (
        <LogRow
          log={log}
          rowKey={rowKey}
          isSelected={selectedLogKey === rowKey}
          onSelect={onSelect}
        />
      );
    },
    [selectedLogKey, onSelect],
  );

  const components = useMemo(
    () => ({
      Footer: () => (
        <div className="text-muted-foreground flex h-12 items-center justify-center px-3 text-xs">
          {isFetchingNextPage ? (
            <span className="flex items-center gap-2">
              <Skeleton className="size-2 rounded-full" />
              Loading more events
            </span>
          ) : hasNextPage ? (
            <span>
              Showing {logs.length.toLocaleString()}
              {totalCount !== undefined
                ? ` of ${totalCount.toLocaleString()}`
                : ""}{" "}
              events
            </span>
          ) : (
            <span>
              Showing all {logs.length.toLocaleString()} matching events
            </span>
          )}
        </div>
      ),
    }),
    [isFetchingNextPage, hasNextPage, totalCount, logs.length],
  );

  return (
    <Virtuoso
      data={logs}
      className="h-full min-h-0 bg-background"
      increaseViewportBy={
        isSelecting ? VIRTUOSO_OVERSCAN_SELECTING : VIRTUOSO_OVERSCAN_IDLE
      }
      endReached={endReached}
      computeItemKey={computeRowKey}
      itemContent={itemContent}
      components={components}
    />
  );
}

const LogRowsSkeleton = memo(function LogRowsSkeleton() {
  return (
    <div className="flex h-full flex-col bg-background">
      {Array.from({ length: 14 }).map((_, index) => (
        <div
          key={index}
          className="grid grid-cols-[86px_minmax(0,1fr)_28px] gap-2 border-b px-3 py-2 md:grid-cols-[112px_minmax(0,1fr)_156px_28px]"
        >
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className="h-3 w-56 max-w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="hidden h-8 w-full md:block" />
          <Skeleton className="h-4 w-4" />
        </div>
      ))}
    </div>
  );
});

export function LogsExplorer({
  repo,
  timeRange,
  search,
  onSearchChange,
  onTimeRangeSelect,
  renderRunLink,
  resolveJobId,
}: LogsExplorerProps) {
  const { showVolume, q, levels, services, repos, traceId } = search;

  const [selectedLogState, setSelectedLogState] = useState<{
    log: LogExplorerRow;
    key: string;
  } | null>(null);

  // Optimistic local mirror of the search filter state. Filter toggles update
  // synchronously so the UI feels instant; onSearchChange runs alongside.
  const [filters, setFilters] = useState(() => ({
    q,
    levels,
    services,
    repos,
    traceId,
  }));

  // Sync from search prop when it changes externally (back/forward, link nav, time range).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setFilters({ q, levels, services, repos, traceId });
  }, [search]);

  const applyFilters = (updates: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...updates }));
    onSearchChange({ ...search, ...updates });
  };

  const filterInput = {
    timeRange,
    query: filters.q,
    levels: filters.levels,
    services: filters.services,
    repos: filters.repos,
    traceId: filters.traceId,
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
  } = useInfiniteQuery({
    ...logsExplorerInfiniteOptions(repo, { ...filterInput, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const { data: totals } = useQuery({
    ...logsTotalsOptions(repo, filterInput),
    placeholderData: keepPreviousData,
  });

  const { data: histogram = [], isPending: isHistogramPending } = useQuery({
    ...logsHistogramOptions(repo, {
      ...filterInput,
      histogramBuckets: DEFAULT_HISTOGRAM_BUCKETS,
    }),
    enabled: showVolume,
    placeholderData: keepPreviousData,
  });

  const pages = data?.pages ?? [];
  const logs = useMemo(() => pages.flatMap((page) => page.logs), [pages]);

  const totalCount = totals?.totalCount;
  const levelCounts = totals?.levelCounts;

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  const handleSelectLog = useCallback(
    (log: LogExplorerRow, key: string) => setSelectedLogState({ log, key }),
    [],
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b bg-muted/10 px-3 py-2">
          <form
            className="w-full"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const newQ = String(form.get("q") ?? "").trim();
              applyFilters({ q: newQ || undefined });
            }}
          >
            <label htmlFor="logs-search" className="sr-only">
              Search logs
            </label>
            <InputGroup className="h-8">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                id="logs-search"
                key={filters.q ?? ""}
                name="q"
                defaultValue={filters.q ?? ""}
                placeholder="Search messages, errors, IDs"
              />
              <InputGroupAddon align="inline-end">
                {filters.q ? (
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Clear query"
                    onClick={() => applyFilters({ q: undefined })}
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
        </div>

        <div
          className={cn(
            "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]",
            selectedLogState &&
              "lg:grid-cols-[220px_minmax(0,1fr)_320px] xl:grid-cols-[260px_minmax(0,1fr)_360px]",
          )}
        >
          <aside className="bg-muted/15 min-h-0 border-b lg:border-r lg:border-b-0">
            <LogFiltersBar
              repo={repo}
              timeRange={timeRange}
              levels={filters.levels}
              services={filters.services}
              repos={filters.repos}
              traceId={filters.traceId}
              levelCounts={levelCounts}
              onChange={(patch) => applyFilters(patch)}
            />
          </aside>

          <main className="min-h-0 min-w-0">
            <div className="flex h-full min-h-0 flex-col">
              <LogHistogram
                buckets={histogram}
                isPending={isHistogramPending}
                showVolume={showVolume}
                onRangeSelect={(from, to) => {
                  setSelectedLogState(null);
                  onTimeRangeSelect?.(from, to);
                }}
                onShowVolumeChange={(isExpanded) =>
                  onSearchChange({ ...search, showVolume: isExpanded })
                }
              />

              <div className="min-h-0 flex-1">
                {isPending ? (
                  <LogRowsSkeleton />
                ) : isError ? (
                  <div className="text-destructive flex h-full min-h-80 items-center justify-center text-sm">
                    Failed to load logs
                  </div>
                ) : logs.length ? (
                  <LogStream
                    logs={logs}
                    selectedLogKey={selectedLogState?.key}
                    totalCount={totalCount}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    onLoadMore={handleLoadMore}
                    onSelect={handleSelectLog}
                  />
                ) : (
                  <div className="text-muted-foreground flex h-full min-h-80 items-center justify-center text-sm">
                    No logs found
                  </div>
                )}
              </div>
            </div>
          </main>

          {selectedLogState ? (
            <aside className="bg-muted/10 min-h-0 min-w-0 lg:border-l">
              <LogInspectorPanel
                repo={repo}
                log={selectedLogState.log}
                onClose={() => setSelectedLogState(null)}
                renderRunLink={renderRunLink}
                resolveJobId={resolveJobId}
              />
            </aside>
          ) : null}
        </div>
      </section>
    </div>
  );
}
