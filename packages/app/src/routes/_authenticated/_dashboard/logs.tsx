import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Separator } from "@everr/ui/components/separator";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import AnsiImport from "ansi-to-react";
import {
  Boxes,
  ChevronRight,
  Clock3,
  FileSearch,
  Fingerprint,
  GitBranch,
  Hash,
  ListFilter,
  Search,
  Server,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Bar, BarChart, ReferenceArea, XAxis } from "recharts";
import { z } from "zod";
import { FilterCombobox } from "@/components/filter-combobox";
import {
  logDetailOptions,
  logRepoFilterOptions,
  logServiceFilterOptions,
  logsExplorerInfiniteOptions,
  logsHistogramOptions,
  logsTotalsOptions,
} from "@/data/logs-explorer/options";
import type {
  LogDetail,
  LogExplorerRow,
  LogHistogramBucket,
  LogLevel,
} from "@/data/logs-explorer/schemas";
import { runJobsOptions } from "@/data/runs/options";
import { formatRelativeTime, formatTimestampTimeOfDay } from "@/lib/formatting";
import { TimeRangeSearchSchema, withTimeRange } from "@/lib/time-range";

const Ansi =
  typeof AnsiImport === "function"
    ? AnsiImport
    : (AnsiImport as unknown as { default: typeof AnsiImport }).default;

export const PAGE_SIZE = 200;
export const DEFAULT_HISTOGRAM_BUCKETS = 80;
const LOG_LEVELS = [
  "error",
  "warning",
  "info",
  "debug",
  "trace",
  "unknown",
] as const satisfies readonly LogLevel[];

const LOG_LEVEL_META = {
  error: {
    label: "Error",
    chartColor: "var(--destructive)",
    dotClassName: "bg-destructive",
    badgeClassName: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  warning: {
    label: "Warning",
    chartColor: "var(--color-amber-500)",
    dotClassName: "bg-amber-500",
    badgeClassName: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  },
  info: {
    label: "Info",
    chartColor: "var(--color-sky-500)",
    dotClassName: "bg-sky-500",
    badgeClassName: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  },
  debug: {
    label: "Debug",
    chartColor: "var(--color-violet-500)",
    dotClassName: "bg-violet-500",
    badgeClassName: "border-violet-500/40 bg-violet-500/10 text-violet-500",
  },
  trace: {
    label: "Trace",
    chartColor: "var(--color-emerald-500)",
    dotClassName: "bg-emerald-500",
    badgeClassName: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  },
  unknown: {
    label: "Unknown",
    chartColor: "var(--muted-foreground)",
    dotClassName: "bg-muted-foreground",
    badgeClassName: "border-border bg-muted/50 text-muted-foreground",
  },
} satisfies Record<
  LogLevel,
  {
    label: string;
    chartColor: string;
    dotClassName: string;
    badgeClassName: string;
  }
>;

export const Route = createFileRoute("/_authenticated/_dashboard/logs")({
  staticData: { breadcrumb: "Logs", fullBleed: true },
  head: () => ({
    meta: [{ title: "Everr - Logs" }],
  }),
  validateSearch: TimeRangeSearchSchema.extend({
    q: z.string().optional(),
    levels: z.array(z.enum(LOG_LEVELS)).default([]),
    services: z.array(z.string()).default([]),
    repos: z.array(z.string()).default([]),
    traceId: z.string().optional(),
    showVolume: z.boolean().default(true),
  }),
  component: LogsExplorerPage,
});

function LogsExplorerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const showVolume = search.showVolume;
  const [selectedLogState, setSelectedLogState] = useState<{
    log: LogExplorerRow;
    key: string;
  } | null>(null);

  const { showVolume: _showVolume, ...rest } = search;
  const urlDeps = withTimeRange(rest);

  // Optimistic local mirror of the URL filter state. Filter toggles update this
  // synchronously so the UI feels instant; the navigate() call sync to URL runs
  // alongside without blocking the visual feedback.
  const [filters, setFilters] = useState(() => ({
    q: urlDeps.q,
    levels: urlDeps.levels,
    services: urlDeps.services,
    repos: urlDeps.repos,
    traceId: urlDeps.traceId,
  }));

  // Sync from URL when it changes externally (back/forward, link nav, time range).
  useEffect(() => {
    setFilters({
      q: urlDeps.q,
      levels: urlDeps.levels,
      services: urlDeps.services,
      repos: urlDeps.repos,
      traceId: urlDeps.traceId,
    });
  }, [search]);

  const filterInput = {
    timeRange: urlDeps.timeRange,
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
    ...logsExplorerInfiniteOptions({ ...filterInput, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const { data: totals } = useQuery({
    ...logsTotalsOptions(filterInput),
    placeholderData: keepPreviousData,
  });
  const { data: histogram = [], isPending: isHistogramPending } = useQuery({
    ...logsHistogramOptions({
      ...filterInput,
      histogramBuckets: DEFAULT_HISTOGRAM_BUCKETS,
    }),
    enabled: showVolume,
    placeholderData: keepPreviousData,
  });

  const pages = data?.pages ?? [];
  const logs = useMemo(() => pages.flatMap((page) => page.logs), [pages]);

  const updateSearch = (updates: Record<string, unknown>, replace = false) => {
    navigate({
      search: (prev) => ({
        ...prev,
        ...updates,
      }),
      replace,
    });
  };

  const applyFilters = (updates: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...updates }));
    updateSearch(updates);
  };

  const toggleLevel = (level: LogLevel) => {
    const levels = filters.levels.includes(level)
      ? filters.levels.filter((item) => item !== level)
      : [...filters.levels, level];
    applyFilters({ levels });
  };

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
      <section className="bg-background text-foreground flex h-full min-h-[720px] flex-col overflow-hidden">
        <div className="border-b bg-muted/10 px-3 py-2">
          <form
            className="w-full"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const q = String(form.get("q") ?? "").trim();
              applyFilters({ q: q || undefined });
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
            "grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]",
            selectedLogState && "xl:grid-cols-[260px_minmax(0,1fr)_360px]",
          )}
        >
          <aside className="bg-muted/15 min-h-0 border-b lg:border-r lg:border-b-0">
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <ListFilter className="text-muted-foreground size-3.5" />
                Filter
              </div>

              <div className="space-y-1">
                {LOG_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={cn(
                      "flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-xs transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                      filters.levels.includes(level) &&
                        "bg-background font-medium shadow-xs ring-1 ring-border",
                    )}
                    onClick={() => toggleLevel(level)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          levelDotClassName(level),
                        )}
                      />
                      <span className="truncate capitalize">{level}</span>
                    </span>
                    <span className="text-muted-foreground font-mono tabular-nums">
                      {levelCounts ? levelCounts[level].toLocaleString() : "—"}
                    </span>
                  </button>
                ))}
              </div>

              <Separator />

              <FilterCombobox
                label="Service"
                values={filters.services}
                onChange={(services) => applyFilters({ services })}
                options={logServiceFilterOptions({
                  timeRange: urlDeps.timeRange,
                })}
                placeholder="All services"
                searchPlaceholder="Search services..."
                className="w-full"
              />
              <FilterCombobox
                label="Source"
                values={filters.repos}
                onChange={(repos) => applyFilters({ repos })}
                options={logRepoFilterOptions({ timeRange: urlDeps.timeRange })}
                placeholder="All sources"
                searchPlaceholder="Search sources..."
                className="w-full"
              />
              <TraceFilter
                traceId={filters.traceId}
                onChange={(traceId) => applyFilters({ traceId })}
              />
            </div>
          </aside>

          <main className="min-h-0 min-w-0 border-b xl:border-b-0">
            <div className="flex h-full min-h-0 flex-col">
              <LogVolumePanel
                isExpanded={showVolume}
                isPending={isHistogramPending}
                histogram={histogram}
                onExpandedChange={(isExpanded) =>
                  updateSearch({ showVolume: isExpanded }, true)
                }
                onSelectRange={({ from, to }) => {
                  setSelectedLogState(null);
                  updateSearch({ from, to });
                }}
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
            <aside className="bg-muted/10 min-h-0 min-w-0 xl:border-l">
              <LogInspectorPanel
                log={selectedLogState.log}
                onClose={() => setSelectedLogState(null)}
              />
            </aside>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function TraceFilter({
  traceId,
  onChange,
}: {
  traceId?: string;
  onChange: (traceId?: string) => void;
}) {
  const [value, setValue] = useState(traceId ?? "");

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        onChange(trimmed || undefined);
      }}
    >
      <label htmlFor="logs-trace-id" className="text-muted-foreground text-xs">
        Trace
      </label>
      <InputGroup className="h-8">
        <InputGroupAddon>
          <Hash />
        </InputGroupAddon>
        <InputGroupInput
          id="logs-trace-id"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Any trace"
        />
        {traceId ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear trace"
              onClick={() => {
                setValue("");
                onChange(undefined);
              }}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </form>
  );
}

const chartConfig = {
  unknown: {
    label: LOG_LEVEL_META.unknown.label,
    color: LOG_LEVEL_META.unknown.chartColor,
  },
  trace: {
    label: LOG_LEVEL_META.trace.label,
    color: LOG_LEVEL_META.trace.chartColor,
  },
  debug: {
    label: LOG_LEVEL_META.debug.label,
    color: LOG_LEVEL_META.debug.chartColor,
  },
  info: {
    label: LOG_LEVEL_META.info.label,
    color: LOG_LEVEL_META.info.chartColor,
  },
  warning: {
    label: LOG_LEVEL_META.warning.label,
    color: LOG_LEVEL_META.warning.chartColor,
  },
  error: {
    label: LOG_LEVEL_META.error.label,
    color: LOG_LEVEL_META.error.chartColor,
  },
} satisfies ChartConfig;

const histogramStack = [
  "unknown",
  "trace",
  "debug",
  "info",
  "warning",
  "error",
] as const satisfies readonly LogLevel[];

function LogVolumePanel({
  isExpanded,
  isPending,
  histogram,
  onExpandedChange,
  onSelectRange,
}: {
  isExpanded: boolean;
  isPending: boolean;
  histogram: LogHistogramBucket[];
  onExpandedChange: (isExpanded: boolean) => void;
  onSelectRange: (range: { from: string; to: string }) => void;
}) {
  return (
    <section className="relative z-10 border-b bg-background">
      <button
        type="button"
        className="group flex h-9 w-full items-center px-3 text-left text-xs transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
        aria-expanded={isExpanded}
        onClick={() => onExpandedChange(!isExpanded)}
      >
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <ChevronRight
            className={cn(
              "text-muted-foreground size-3.5 transition-transform",
              isExpanded && "rotate-90",
            )}
          />
          <span>Log volume</span>
        </span>
      </button>

      {isExpanded ? (
        <div className="px-3 pb-2">
          {isPending ? (
            <Skeleton className="h-[104px] w-full" />
          ) : histogram.length ? (
            <LogHistogram data={histogram} onSelectRange={onSelectRange} />
          ) : (
            <div className="text-muted-foreground flex h-[104px] items-center justify-center rounded-md border border-dashed text-sm">
              No log volume in this range
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

type HistogramMouseEvent = {
  activeTooltipIndex?: number | null;
};

function histogramEventIndex(
  event: unknown,
  data: LogHistogramBucket[],
): number | null {
  const index = (event as HistogramMouseEvent | undefined)?.activeTooltipIndex;
  if (typeof index !== "number" || index < 0 || index >= data.length) {
    return null;
  }
  return index;
}

function LogHistogram({
  data,
  onSelectRange,
}: {
  data: LogHistogramBucket[];
  onSelectRange: (range: { from: string; to: string }) => void;
}) {
  const [dragRange, setDragRange] = useState<{
    startIndex: number;
    endIndex: number;
  } | null>(null);

  const activeRange = dragRange
    ? {
        startIndex: Math.min(dragRange.startIndex, dragRange.endIndex),
        endIndex: Math.max(dragRange.startIndex, dragRange.endIndex),
      }
    : null;
  const selectedStart = activeRange ? data[activeRange.startIndex] : undefined;
  const selectedEnd = activeRange ? data[activeRange.endIndex] : undefined;

  const startDrag = (event: unknown) => {
    const index = histogramEventIndex(event, data);
    if (index === null) return;
    setDragRange({ startIndex: index, endIndex: index });
  };

  const updateDrag = (event: unknown) => {
    const index = histogramEventIndex(event, data);
    if (index === null) return;
    setDragRange((currentRange) =>
      currentRange ? { ...currentRange, endIndex: index } : currentRange,
    );
  };

  const commitDrag = (event: unknown) => {
    const finalIndex = histogramEventIndex(event, data);
    const committedRange =
      dragRange && finalIndex !== null
        ? { ...dragRange, endIndex: finalIndex }
        : dragRange;

    if (committedRange) {
      const startIndex = Math.min(
        committedRange.startIndex,
        committedRange.endIndex,
      );
      const endIndex = Math.max(
        committedRange.startIndex,
        committedRange.endIndex,
      );
      const startBucket = data[startIndex];
      const endBucket = data[endIndex];

      onSelectRange({
        from: startBucket.timestamp,
        to: endBucket.endTimestamp,
      });
    }
    setDragRange(null);
  };

  return (
    <ChartContainer
      config={chartConfig}
      className="h-[104px] w-full select-none [&_.recharts-wrapper]:cursor-ew-resize"
      onMouseDown={(event) => event.preventDefault()}
    >
      <BarChart
        data={data}
        margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
        onMouseDown={startDrag}
        onMouseMove={updateDrag}
        onMouseUp={commitDrag}
        onMouseLeave={() => setDragRange(null)}
      >
        <XAxis
          dataKey="timestamp"
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          fontSize={10}
          interval="preserveStartEnd"
          tickFormatter={(value) =>
            new Date(value).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          }
        />
        <ChartTooltip
          cursor={false}
          wrapperStyle={{ zIndex: 50 }}
          content={
            <ChartTooltipContent
              className="z-50 bg-popover text-popover-foreground"
              labelFormatter={(_value, payload) =>
                payload?.[0]?.payload?.rangeLabel
              }
              formatter={(value, name) => (
                <>
                  <div
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: `var(--color-${name})` }}
                  />
                  <span className="text-muted-foreground">
                    {chartConfig[name as keyof typeof chartConfig]?.label}
                  </span>
                  <span className="ml-auto font-mono font-medium tabular-nums">
                    {(value as number).toLocaleString()}
                  </span>
                </>
              )}
            />
          }
        />
        {histogramStack.map((level) => (
          <Bar
            key={level}
            dataKey={level}
            stackId="logs"
            fill={`var(--color-${level})`}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        ))}
        {selectedStart && selectedEnd ? (
          <ReferenceArea
            x1={selectedStart.timestamp}
            x2={selectedEnd.timestamp}
            isFront
            fill="var(--primary)"
            fillOpacity={0.08}
            stroke="var(--primary)"
            strokeOpacity={0.35}
            strokeDasharray="3 3"
          />
        ) : null}
      </BarChart>
    </ChartContainer>
  );
}

type RangeSelection = { startIndex: number; endIndex: number };

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
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [rangeSelection, setRangeSelection] = useState<RangeSelection | null>(
    null,
  );

  const dragRef = useRef<{
    active: boolean;
    startIndex: number | null;
    crossed: boolean;
  }>({ active: false, startIndex: null, crossed: false });

  // Document mouse listeners: drag tracking, auto-scroll, outside-click clear, Escape.
  useEffect(() => {
    let rafId: number | null = null;
    let scrollSpeed = 0;
    let lastClientY = 0;

    const updateRange = () => {
      if (!dragRef.current.active || dragRef.current.startIndex === null) {
        return;
      }
      const index = findRowIndexAtY(lastClientY, scrollerRef.current);
      if (index === null) return;
      if (index !== dragRef.current.startIndex) {
        dragRef.current.crossed = true;
        window.getSelection()?.removeAllRanges();
      }
      if (!dragRef.current.crossed) return;
      const startIndex = dragRef.current.startIndex;
      setRangeSelection((prev) =>
        prev && prev.startIndex === startIndex && prev.endIndex === index
          ? prev
          : { startIndex, endIndex: index },
      );
    };

    const tick = () => {
      const scroller = scrollerRef.current;
      if (!scroller || scrollSpeed === 0) {
        rafId = null;
        return;
      }
      scroller.scrollTop += scrollSpeed;
      updateRange();
      rafId = requestAnimationFrame(tick);
    };

    const stopAutoScroll = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      scrollSpeed = 0;
    };

    const onMove = (event: MouseEvent) => {
      if (!dragRef.current.active) return;
      lastClientY = event.clientY;
      updateRange();

      const scroller = scrollerRef.current;
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect();
      const SCROLL_ZONE = 40;
      const distFromTop = event.clientY - rect.top;
      const distFromBottom = rect.bottom - event.clientY;
      if (distFromTop < SCROLL_ZONE) {
        scrollSpeed = -Math.max(2, (SCROLL_ZONE - distFromTop) * 0.6);
      } else if (distFromBottom < SCROLL_ZONE) {
        scrollSpeed = Math.max(2, (SCROLL_ZONE - distFromBottom) * 0.6);
      } else {
        scrollSpeed = 0;
      }
      if (scrollSpeed !== 0 && rafId === null) {
        rafId = requestAnimationFrame(tick);
      } else if (scrollSpeed === 0) {
        stopAutoScroll();
      }
    };

    const onUp = () => {
      dragRef.current.active = false;
      dragRef.current.startIndex = null;
      stopAutoScroll();
    };

    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && scrollerRef.current?.contains(target)) return;
      setRangeSelection(null);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRangeSelection(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      stopAutoScroll();
    };
  }, []);

  // Clear range selection when the query result changes (filter/search), but not
  // when infinite scroll appends older pages. logs[0] is the newest row and only
  // changes when the underlying query does.
  const firstLogId = logs[0]?.id;
  useEffect(() => {
    setRangeSelection(null);
  }, [firstLogId]);

  // Copy handler — assemble selected rows' text from logs[].
  useEffect(() => {
    if (!rangeSelection) return;
    const onCopy = (event: ClipboardEvent) => {
      const min = Math.min(rangeSelection.startIndex, rangeSelection.endIndex);
      const max = Math.max(rangeSelection.startIndex, rangeSelection.endIndex);
      const text = logs
        .slice(min, max + 1)
        .map((log) => stripAnsi(log.body))
        .join("\n");
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [rangeSelection, logs]);

  const handleRowMouseDown = useCallback((index: number) => {
    dragRef.current = { active: true, startIndex: index, crossed: false };
    setRangeSelection(null);
  }, []);

  const handleRowClick = useCallback(
    (log: LogExplorerRow, key: string) => {
      if (dragRef.current.crossed) return;
      if (hasActiveTextSelection()) return;
      onSelect(log, key);
    },
    [onSelect],
  );

  const endReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) onLoadMore();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  const minSelected = rangeSelection
    ? Math.min(rangeSelection.startIndex, rangeSelection.endIndex)
    : -1;
  const maxSelected = rangeSelection
    ? Math.max(rangeSelection.startIndex, rangeSelection.endIndex)
    : -1;

  const itemContent = useCallback(
    (index: number, log: LogExplorerRow) => {
      const rowKey = `${log.id}:${index}`;
      const inRange = index >= minSelected && index <= maxSelected;
      return (
        <LogRow
          index={index}
          log={log}
          rowKey={rowKey}
          isSelected={selectedLogKey === rowKey}
          isInRange={inRange}
          onMouseDown={handleRowMouseDown}
          onSelect={handleRowClick}
        />
      );
    },
    [
      selectedLogKey,
      handleRowClick,
      handleRowMouseDown,
      minSelected,
      maxSelected,
    ],
  );

  const components = useMemo(
    () => ({
      Footer: () => (
        <div className="text-muted-foreground flex h-12 items-center justify-center border-b px-3 text-xs">
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
      scrollerRef={(el) => {
        scrollerRef.current = el as HTMLElement | null;
      }}
      increaseViewportBy={VIRTUOSO_OVERSCAN}
      endReached={endReached}
      computeItemKey={computeRowKey}
      itemContent={itemContent}
      components={components}
    />
  );
}

// Covers CSI (color/cursor), OSC (titles/hyperlinks), and single-char escapes.
const ANSI_REGEX =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: required to match ANSI escapes
  /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[@-_])/g;

function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, "");
}

function findRowIndexAtY(
  clientY: number,
  scroller: HTMLElement | null,
): number | null {
  if (!scroller) return null;
  const rect = scroller.getBoundingClientRect();
  // Probe a point inside the scroller, off the left edge to avoid the level accent bar.
  const x = rect.left + 16;
  const clampedY = Math.min(Math.max(clientY, rect.top + 1), rect.bottom - 1);
  const target = document.elementFromPoint(x, clampedY);
  const rowEl = target?.closest("[data-log-index]") as HTMLElement | null;
  if (!rowEl) return null;
  const value = rowEl.getAttribute("data-log-index");
  if (!value) return null;
  const index = Number(value);
  return Number.isFinite(index) ? index : null;
}

const VIRTUOSO_OVERSCAN = { top: 400, bottom: 400 };

function computeRowKey(index: number, log: LogExplorerRow) {
  return `${log.id}:${index}`;
}

const LogRow = memo(function LogRow({
  index,
  log,
  rowKey,
  isSelected,
  isInRange,
  onMouseDown,
  onSelect,
}: {
  index: number;
  log: LogExplorerRow;
  rowKey: string;
  isSelected: boolean;
  isInRange: boolean;
  onMouseDown: (index: number) => void;
  onSelect: (log: LogExplorerRow, key: string) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: Native buttons prevent selecting log text for copy.
    <div
      role="button"
      tabIndex={0}
      data-log-index={index}
      className={cn(
        "relative group grid w-full cursor-default grid-cols-[86px_minmax(0,1fr)] items-start text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 md:grid-cols-[112px_minmax(0,1fr)]",
        isSelected && "bg-muted/70 hover:bg-muted/70",
      )}
      onMouseDown={() => onMouseDown(index)}
      onClick={() => onSelect(log, rowKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(log, rowKey);
        }
      }}
    >
      <div
        className={cn(
          "self-stretch absolute left-0 top-px bottom-px w-[3px]",
          levelAccentClassName(log.level),
        )}
      />

      <div className="px-3 py-0.5">
        <span className="block select-none font-mono text-[0.75rem] leading-4 text-muted-foreground tabular-nums">
          {formatTimestampTimeOfDay(log.timestamp)}
        </span>
      </div>

      <div
        className={cn("min-w-0 px-3 pr-9 py-0.5", isInRange && "bg-primary/20")}
      >
        <div className="select-text whitespace-pre-wrap break-words font-mono text-[0.75rem] leading-4 min-h-4 text-foreground">
          <Ansi useClasses>{log.body}</Ansi>
        </div>
      </div>

      <ChevronRight
        aria-hidden="true"
        className="absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted-foreground opacity-0 group-hover:opacity-100"
      />
    </div>
  );
});

function useDelayedFlag(active: boolean, delayMs: number) {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!active) {
      setDelayed(false);
      return;
    }
    const id = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(id);
  }, [active, delayMs]);
  return delayed;
}

function hasActiveTextSelection() {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

function LogInspectorPanel({
  log,
  onClose,
}: {
  log: LogExplorerRow;
  onClose: () => void;
}) {
  const {
    data: detail,
    isPending,
    isError,
    isPlaceholderData,
  } = useQuery({
    ...logDetailOptions(log.identity),
    placeholderData: keepPreviousData,
  });
  const showSkeleton = useDelayedFlag(isPending, 250);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-3">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Log event</div>
            <div className="text-muted-foreground text-xs">
              {formatRelativeTime(log.timestamp)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn("capitalize", levelBadgeClassName(log.level))}
            >
              {log.level}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close log details"
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-4 rounded-md border bg-background p-3">
          <div className="text-muted-foreground mb-2 text-xs font-medium">
            Message
          </div>
          <div className="font-mono text-xs leading-5">
            <Ansi useClasses>{log.body}</Ansi>
          </div>
        </div>

        {isError ? (
          <div className="text-destructive rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            Failed to load log details
          </div>
        ) : detail ? (
          <div
            className={cn(
              "transition-opacity",
              isPlaceholderData && "opacity-50",
            )}
          >
            <LogInspectorDetails detail={detail} />
          </div>
        ) : showSkeleton ? (
          <LogInspectorSkeleton />
        ) : null}
      </div>
    </div>
  );
}

function LogInspectorDetails({ detail }: { detail: LogDetail }) {
  const ciFields = extractCiContext(detail);
  const { data: jobs } = useQuery({
    ...runJobsOptions(detail.traceId),
    enabled: Boolean(detail.traceId && ciFields.jobName),
  });
  const resolvedJobId =
    ciFields.jobId ||
    jobs?.find((job) => job.name === ciFields.jobName)?.jobId ||
    "";

  return (
    <>
      <DetailSection title="Event">
        <DetailItem
          icon={<Clock3 />}
          label="Timestamp"
          value={detail.timestamp}
        />
        <DetailItem
          icon={<Server />}
          label="Service"
          value={detail.serviceName}
        />
        <DetailItem label="Severity" value={severityLabel(detail)} />
        <DetailItem
          icon={<Boxes />}
          label="Source"
          value={ciFields.repo || "default"}
        />
      </DetailSection>

      <DetailSection title="Correlation">
        <DetailItem
          icon={<Fingerprint />}
          label="Trace ID"
          value={detail.traceId}
          mono
        />
        <DetailItem label="Span ID" value={detail.spanId} mono />
      </DetailSection>

      {ciFields.hasAny ? (
        <DetailSection title="CI/CD">
          <DetailItem
            icon={<GitBranch />}
            label="Branch"
            value={ciFields.branch}
          />
          <DetailItem label="Pipeline" value={ciFields.workflowName} />
          <DetailItem label="Execution ID" value={ciFields.runId} mono />
          <DetailItem label="Task" value={ciFields.jobName || ciFields.jobId} />
          <DetailItem label="Step" value={ciFields.stepNumber} />
          {detail.traceId && resolvedJobId && ciFields.stepNumber && (
            <Button
              variant="outline"
              size="sm"
              className="mt-1 w-fit"
              nativeButton={false}
              render={
                <Link
                  to="/runs/$traceId/jobs/$jobId/steps/$stepNumber"
                  params={{
                    traceId: detail.traceId,
                    jobId: resolvedJobId,
                    stepNumber: ciFields.stepNumber,
                  }}
                />
              }
            >
              <FileSearch data-icon="inline-start" />
              Open in CI View
            </Button>
          )}
        </DetailSection>
      ) : null}

      <AttributeMap
        title="Resource attributes"
        map={detail.resourceAttributes}
      />
      <AttributeMap title="Log attributes" map={detail.logAttributes} />
      <AttributeMap title="Scope attributes" map={detail.scopeAttributes} />
    </>
  );
}

function LogInspectorSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, sectionIndex) => (
        <div key={sectionIndex} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

function AttributeMap({
  title,
  map,
}: {
  title: string;
  map: Record<string, string>;
}) {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  return (
    <DetailSection title={title}>
      {entries.map(([key, value]) => (
        <DetailItem key={key} label={key} value={value} mono />
      ))}
    </DetailSection>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <h2 className="text-muted-foreground mb-2 text-xs font-medium">
        {title}
      </h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function DetailItem({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-md border bg-background/70 px-2.5 py-2 text-xs">
      <span className="text-muted-foreground flex min-w-0 items-center gap-1">
        {icon ? <span className="[&>svg]:size-3">{icon}</span> : null}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-right",
          mono && "font-mono",
          !value && "text-muted-foreground",
        )}
      >
        {value || "N/A"}
      </span>
    </div>
  );
}

function severityLabel(log: LogDetail) {
  if (log.severityText) return log.severityText;
  if (log.severityNumber > 0) return String(log.severityNumber);
  return "N/A";
}

function extractCiContext(detail: LogDetail) {
  const repo = detail.resourceAttributes["vcs.repository.name"] ?? "";
  const branch = detail.resourceAttributes["vcs.ref.head.name"] ?? "";
  const workflowName = detail.resourceAttributes["cicd.pipeline.name"] ?? "";
  const runId = detail.resourceAttributes["cicd.pipeline.run.id"] ?? "";
  const jobId = detail.resourceAttributes["cicd.pipeline.task.run.id"] ?? "";
  const jobName = detail.scopeAttributes["cicd.pipeline.task.name"] ?? "";
  const stepNumber =
    detail.logAttributes["everr.github.workflow_job_step.number"] ?? "";
  return {
    repo,
    branch,
    workflowName,
    runId,
    jobId,
    jobName,
    stepNumber,
    hasAny: Boolean(
      branch || workflowName || runId || jobId || jobName || stepNumber,
    ),
  };
}

function levelBadgeClassName(level: LogLevel) {
  return LOG_LEVEL_META[level].badgeClassName;
}

function levelAccentClassName(level: LogLevel) {
  return LOG_LEVEL_META[level].dotClassName;
}

function levelDotClassName(level: LogLevel) {
  return LOG_LEVEL_META[level].dotClassName;
}

function LogRowsSkeleton() {
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
}
