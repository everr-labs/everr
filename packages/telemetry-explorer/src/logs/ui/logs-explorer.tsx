import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { RetryError } from "@everr/ui/components/retry-error";
import { ScrollAreaScroller } from "@everr/ui/components/scroll-area";
import { Skeleton } from "@everr/ui/components/skeleton";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { withEnvironment } from "../../filters/environment";
import { countPersistentFilters } from "../../filters/ui/explore-global-filters";
import {
  logsExplorerInfiniteOptions,
  logsHistogramOptions,
  logsTotalsOptions,
} from "../data/options";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeFilter, LogExplorerRow, LogLevel } from "../schemas";
import { LogFiltersBar } from "./log-filters";
import { LogHistogram } from "./log-histogram";
import { LogInspectorPanel } from "./log-inspector";
import { DEFAULT_HISTOGRAM_BUCKETS, PAGE_SIZE } from "./log-level-meta";
import { LogRow } from "./log-row";

export interface LogsExplorerSearch {
  q?: string;
  levels: LogLevel[];
  services: string[];
  attributes: AttributeFilter[];
  traceId?: string;
  showVolume: boolean;
}

export interface LogsExplorerProps {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  search: LogsExplorerSearch;
  environment?: string[];
  // The top zone of the rail: Service and Environment. The host app supplies it,
  // because the two values are search params that the pages share.
  persistentFilters?: ReactNode;
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
      Scroller: ScrollAreaScroller,
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
  environment = [],
  persistentFilters,
  onSearchChange,
  onTimeRangeSelect,
  renderRunLink,
  resolveJobId,
}: LogsExplorerProps) {
  // Default `attributes` to [] so a consumer that hand-builds the search object
  // without it (e.g. an external embedder) can't crash the filter UI on `.map`.
  const { showVolume, q, levels, services, attributes = [], traceId } = search;

  const [selectedLogState, setSelectedLogState] = useState<{
    log: LogExplorerRow;
    key: string;
  } | null>(null);
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(false);

  // Optimistic local mirror of the search filter state. Filter toggles update
  // synchronously so the UI feels instant; onSearchChange runs alongside.
  const [filters, setFilters] = useState(() => ({
    q,
    levels,
    services,
    attributes,
    traceId,
  }));

  // Sync from search prop when it changes externally (back/forward, link nav, time range).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setFilters({ q, levels, services, attributes, traceId });
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
    attributes: withEnvironment(filters.attributes, environment),
    traceId: filters.traceId,
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
  const logs = useMemo(
    () => pages.flatMap((page) => page?.logs ?? []),
    [pages],
  );

  const totalCount = totals?.totalCount;
  const levelCounts = totals?.levelCounts;

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  const handleSelectLog = useCallback(
    (log: LogExplorerRow, key: string) => setSelectedLogState({ log, key }),
    [],
  );

  const handleCloseInspector = useCallback(() => {
    setSelectedLogState(null);
    setIsInspectorExpanded(false);
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div
          className={cn(
            // Below `lg` the rail becomes a bar with a "Filters" button. The
            // bar must take only the height that it needs, which is `auto`, so
            // that the log list keeps the remaining height. The traces grid and
            // the errors grid use the same rule.
            "grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]",
            selectedLogState &&
              "lg:grid-cols-[220px_minmax(0,1fr)_320px] xl:grid-cols-[260px_minmax(0,1fr)_360px]",
          )}
        >
          <LogFiltersBar
            repo={repo}
            timeRange={timeRange}
            q={filters.q ?? ""}
            levels={filters.levels}
            attributes={filters.attributes}
            traceId={filters.traceId}
            levelCounts={levelCounts}
            persistentFilters={persistentFilters}
            persistentFilterCount={countPersistentFilters(
              filters.services,
              environment,
            )}
            onChange={applyFilters}
          />

          <main className="min-h-0 min-w-0">
            <div className="flex h-full min-h-0 flex-col">
              <LogHistogram
                buckets={histogram}
                isPending={isHistogramPending}
                showVolume={showVolume}
                onRangeSelect={(from, to) => {
                  handleCloseInspector();
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
                  <RetryError
                    title="Failed to load logs"
                    message={(error as Error).message}
                    onRetry={() => {
                      void refetch();
                    }}
                  />
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
                onClose={handleCloseInspector}
                onExpand={() => setIsInspectorExpanded(true)}
                renderRunLink={renderRunLink}
                resolveJobId={resolveJobId}
              />
            </aside>
          ) : null}
        </div>

        <Dialog
          open={isInspectorExpanded && selectedLogState !== null}
          onOpenChange={(open) => {
            if (!open) setIsInspectorExpanded(false);
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="flex h-[85vh] w-[90vw] max-w-none gap-0 overflow-hidden rounded-lg p-0 sm:max-w-4xl"
          >
            <DialogTitle className="sr-only">Log event</DialogTitle>
            {selectedLogState ? (
              <LogInspectorPanel
                repo={repo}
                log={selectedLogState.log}
                onClose={() => setIsInspectorExpanded(false)}
                renderRunLink={renderRunLink}
                resolveJobId={resolveJobId}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      </section>
    </div>
  );
}
