import { staleClass } from "@everr/ui/lib/stale";
import { useRetained } from "@everr/ui/hooks/use-retained";
import { Spinner } from "@everr/ui/components/spinner";
import { Dialog, DialogContent, DialogTitle } from "@everr/ui/components/dialog";
import { RetryError } from "@everr/ui/components/retry-error";
import {
  virtuosoInitialItemCount,
  virtuosoScrollAreaComponents,
} from "@everr/ui/components/scroll-area";
import { Drawer, DrawerContent, DrawerTitle } from "@everr/ui/components/drawer";
import { Sheet, SheetContent, SheetTitle } from "@everr/ui/components/sheet";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useIsMobile, useIsNarrow } from "@everr/ui/hooks/use-mobile";
import { rangeSpansDays, type TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
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
import { NoResults, showingAll } from "../../filters/ui/no-results";
import { countLogPageFilters, LogFiltersBar } from "./log-filters";
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
  renderRunLink?: (ctx: { traceId: string; jobId: string; stepNumber: string }) => ReactNode;
  resolveJobId?: (input: { traceId: string; jobName: string }) => string | undefined;
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
  withDay,
}: {
  logs: LogExplorerRow[];
  selectedLogKey?: string;
  totalCount?: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onSelect: (log: LogExplorerRow, key: string) => void;
  withDay: boolean;
}) {
  const [isSelecting, setIsSelecting] = useState(false);

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      setIsSelecting(Boolean(selection && !selection.isCollapsed));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
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
          withDay={withDay}
        />
      );
    },
    [selectedLogKey, onSelect, withDay],
  );

  const components = useMemo(
    () => ({
      ...virtuosoScrollAreaComponents,
      // oxlint-disable-next-line react/no-unstable-nested-components -- Preserve the existing footer component lifetime when pagination values change.
      Footer: () => (
        <div className="text-muted-foreground flex h-10 items-center justify-center px-3 text-xs">
          {isFetchingNextPage ? (
            <span className="flex items-center gap-2">
              <Spinner className="size-3" />
              Loading more events
            </span>
          ) : hasNextPage ? (
            <span>
              Showing {logs.length.toLocaleString()}
              {totalCount !== undefined ? ` of ${totalCount.toLocaleString()}` : ""} events
            </span>
          ) : (
            <span>{showingAll(logs.length, "event")}</span>
          )}
        </div>
      ),
    }),
    [isFetchingNextPage, hasNextPage, totalCount, logs.length],
  );

  return (
    <Virtuoso
      data={logs}
      initialItemCount={virtuosoInitialItemCount(logs.length)}
      className="h-full min-h-0 bg-background"
      increaseViewportBy={isSelecting ? VIRTUOSO_OVERSCAN_SELECTING : VIRTUOSO_OVERSCAN_IDLE}
      endReached={endReached}
      computeItemKey={computeRowKey}
      itemContent={itemContent}
      components={components}
    />
  );
}

/** Ragged like real rows, but fixed so every render draws the same shape. */
const SKELETON_MESSAGE_WIDTHS = ["72%", "48%", "86%", "35%", "64%", "91%", "41%", "58%"];

/** About a tall screen of rows. No more: every bar repaints its shimmer each frame. */
const SKELETON_ROW_COUNT = 60;

/** On `LogRow`'s own grid and time column, so messages start where they will. */
const LogRowsSkeleton = memo(function LogRowsSkeleton({ withDay }: { withDay: boolean }) {
  return (
    <div aria-hidden className="h-full overflow-hidden bg-background">
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
        <div
          key={index}
          className={cn(
            "grid grid-cols-1 py-0.5 font-mono text-[0.75rem] md:py-0",
            withDay
              ? "md:grid-cols-[calc(19ch+0.75rem)_minmax(0,1fr)]"
              : "md:grid-cols-[calc(11ch+0.75rem)_minmax(0,1fr)]",
          )}
        >
          <div className="flex h-4 items-center px-3 md:h-5 md:pr-0">
            {/* As wide as a typical time: "8:46:35 PM", "Nov 21, 8:46:35 PM". */}
            <Skeleton className={cn("h-2.5 rounded-sm", withDay ? "w-[18ch]" : "w-[10ch]")} />
          </div>
          <div className="flex h-4 min-w-0 items-center px-3 md:h-5 md:pr-9">
            <Skeleton
              className="h-2.5 rounded-sm"
              style={{
                width: SKELETON_MESSAGE_WIDTHS[index % SKELETON_MESSAGE_WIDTHS.length],
              }}
            />
          </div>
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
  // oxlint-disable-next-line typescript/no-useless-default-assignment -- Preserve the runtime fallback for untyped callers that omit attributes.
  const { showVolume, q, levels, services, attributes = [], traceId } = search;

  const [selectedLogState, setSelectedLogState] = useState<{
    log: LogExplorerRow;
    key: string;
  } | null>(null);
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(false);
  // Below `lg` there is no room for the inspector column beside the list, so
  // a log's details open over it: a side sheet, the way alert details do, and
  // on a phone a bottom drawer, swiped down to close. A sheet edge to edge
  // there reads as a page, and the edge swipe that would leave it is the
  // browser's back.
  const isNarrow = useIsNarrow();
  const isMobile = useIsMobile();
  const inspectorColumn = selectedLogState !== null && !isNarrow;

  // Optimistic local mirror of the search filter state. Filter toggles update
  // synchronously so the UI feels instant; onSearchChange runs alongside.
  const [filterState, setFilterState] = useState(() => ({
    search,
    value: { q, levels, services, attributes, traceId },
  }));

  // Reconcile external navigation before children render, retaining optimistic
  // edits until the route supplies a new search object.
  const filters =
    filterState.search === search
      ? filterState.value
      : { q, levels, services, attributes, traceId };
  if (filterState.search !== search) {
    setFilterState({ search, value: filters });
  }

  const applyFilters = (updates: Partial<typeof filters>) => {
    setFilterState((previous) => ({
      ...previous,
      value: { ...previous.value, ...updates },
    }));
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
    isPlaceholderData,
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
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Preserve the original empty-page memoization behavior during loading.
  const logs = useMemo(() => pages.flatMap((page) => page?.logs ?? []), [pages]);

  const totalCount = totals?.totalCount;
  const levelCounts = totals?.levelCounts;

  const handleLoadMore = useCallback(() => {
    // oxlint-disable-next-line typescript/no-floating-promises -- Preserve the original callback execution and return contract without adding a runtime wrapper.
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

  const shownLog = useRetained(selectedLogState);

  // The inspector in the drawer or the sheet; the column and the expanded
  // dialog render their own, with an expand button the overlays don't have.
  const overlayInspector = shownLog ? (
    <LogInspectorPanel
      repo={repo}
      log={shownLog.log}
      onClose={handleCloseInspector}
      renderRunLink={renderRunLink}
      resolveJobId={resolveJobId}
    />
  ) : null;

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
            inspectorColumn &&
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
            persistentFilterCount={countPersistentFilters(filters.services, environment)}
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

              <div
                aria-busy={isPlaceholderData}
                className={cn("min-h-0 flex-1", staleClass(isPlaceholderData))}
              >
                {isPending ? (
                  <LogRowsSkeleton withDay={rangeSpansDays(timeRange)} />
                ) : isError ? (
                  <RetryError
                    title="Failed to load logs"
                    message={error.message}
                    onRetry={() => {
                      void refetch();
                    }}
                  />
                ) : logs.length ? (
                  <LogStream
                    withDay={rangeSpansDays(timeRange)}
                    logs={logs}
                    selectedLogKey={selectedLogState?.key}
                    totalCount={totalCount}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    onLoadMore={handleLoadMore}
                    onSelect={handleSelectLog}
                  />
                ) : (
                  <NoResults
                    // Its box is not a flex column, unlike the other
                    // explorers', so the state fills it to stay centred.
                    className="h-full"
                    noun="logs"
                    timeRange={timeRange}
                    filterCount={
                      countPersistentFilters(filters.services, environment) +
                      countLogPageFilters(filters)
                    }
                    onClearFilters={
                      countLogPageFilters(filters) > 0
                        ? () =>
                            applyFilters({
                              q: undefined,
                              levels: [],
                              attributes: [],
                              traceId: undefined,
                            })
                        : undefined
                    }
                  />
                )}
              </div>
            </div>
          </main>

          {inspectorColumn ? (
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

        {/* The panel draws its own close button. No expand: the drawer or the
            sheet is already as large as the screen allows. */}
        {isNarrow && isMobile ? (
          <Drawer
            showSwipeHandle
            open={selectedLogState !== null}
            onOpenChange={(open) => !open && handleCloseInspector()}
          >
            <DrawerContent className="[--drawer-content-height:100dvh]">
              <DrawerTitle className="sr-only">Log event</DrawerTitle>
              {overlayInspector}
            </DrawerContent>
          </Drawer>
        ) : isNarrow ? (
          <Sheet
            open={selectedLogState !== null}
            onOpenChange={(open) => !open && handleCloseInspector()}
          >
            <SheetContent
              showCloseButton={false}
              className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[30rem]"
            >
              <SheetTitle className="sr-only">Log event</SheetTitle>
              {overlayInspector}
            </SheetContent>
          </Sheet>
        ) : null}

        <Dialog
          open={isInspectorExpanded && inspectorColumn}
          onOpenChange={(open) => {
            if (!open) setIsInspectorExpanded(false);
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="flex h-[85vh] w-[90vw] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-4xl"
          >
            <DialogTitle className="sr-only">Log event</DialogTitle>
            {shownLog ? (
              <LogInspectorPanel
                repo={repo}
                log={shownLog.log}
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
