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
import { useInfiniteQuery } from "@tanstack/react-query";
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
import { useMemo, useState } from "react";
import { Bar, BarChart, ReferenceArea, XAxis } from "recharts";
import { z } from "zod";
import { FilterCombobox } from "@/components/filter-combobox";
import {
  logRepoFilterOptions,
  logServiceFilterOptions,
  logsExplorerInfiniteOptions,
} from "@/data/logs-explorer/options";
import type {
  LogExplorerRow,
  LogHistogramBucket,
  LogLevel,
} from "@/data/logs-explorer/schemas";
import { formatRelativeTime, formatTimestampTimeOfDay } from "@/lib/formatting";
import { TimeRangeSearchSchema, withTimeRange } from "@/lib/time-range";

const Ansi =
  typeof AnsiImport === "function"
    ? AnsiImport
    : (AnsiImport as unknown as { default: typeof AnsiImport }).default;

const PAGE_SIZE = 200;
const DEFAULT_HISTOGRAM_BUCKETS = 80;
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
  }),
  loaderDeps: ({ search }) => withTimeRange(search),
  loader: async ({ context: { queryClient }, deps }) => {
    await queryClient.prefetchInfiniteQuery(
      logsExplorerInfiniteOptions({
        timeRange: deps.timeRange,
        query: deps.q,
        levels: deps.levels,
        services: deps.services,
        repos: deps.repos,
        traceId: deps.traceId,
        limit: PAGE_SIZE,
        histogramBuckets: DEFAULT_HISTOGRAM_BUCKETS,
      }),
    );
  },
  pendingComponent: LogsExplorerSkeleton,
  component: LogsExplorerPage,
});

function LogsExplorerPage() {
  const deps = Route.useLoaderDeps();
  const navigate = Route.useNavigate();
  const [selectedLogState, setSelectedLogState] = useState<{
    log: LogExplorerRow;
    key: string;
  } | null>(null);

  const input = {
    timeRange: deps.timeRange,
    query: deps.q,
    levels: deps.levels,
    services: deps.services,
    repos: deps.repos,
    traceId: deps.traceId,
    limit: PAGE_SIZE,
    histogramBuckets: DEFAULT_HISTOGRAM_BUCKETS,
  };
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
  } = useInfiniteQuery(logsExplorerInfiniteOptions(input));

  const pages = data?.pages ?? [];
  const summary = pages[0];
  const logs = useMemo(() => pages.flatMap((page) => page.logs), [pages]);

  const updateSearch = (updates: Record<string, unknown>) => {
    navigate({
      search: (prev) => ({
        ...prev,
        ...updates,
      }),
    });
  };

  const toggleLevel = (level: LogLevel) => {
    const levels = deps.levels.includes(level)
      ? deps.levels.filter((item) => item !== level)
      : [...deps.levels, level];
    updateSearch({ levels });
  };

  const totalCount = summary?.totalCount ?? 0;

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
              updateSearch({ q: q || undefined });
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
                key={deps.q ?? ""}
                name="q"
                defaultValue={deps.q ?? ""}
                placeholder="Search messages, errors, IDs"
              />
              <InputGroupAddon align="inline-end">
                {deps.q ? (
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Clear query"
                    onClick={() => updateSearch({ q: undefined })}
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
                      deps.levels.includes(level) &&
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
                      {(summary?.levelCounts[level] ?? 0).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>

              <Separator />

              <FilterCombobox
                label="Service"
                values={deps.services}
                onChange={(services) => updateSearch({ services })}
                options={logServiceFilterOptions({ timeRange: deps.timeRange })}
                placeholder="All services"
                searchPlaceholder="Search services..."
                className="w-full"
              />
              <FilterCombobox
                label="Source"
                values={deps.repos}
                onChange={(repos) => updateSearch({ repos })}
                options={logRepoFilterOptions({ timeRange: deps.timeRange })}
                placeholder="All sources"
                searchPlaceholder="Search sources..."
                className="w-full"
              />
              <TraceFilter
                traceId={deps.traceId}
                onChange={(traceId) => updateSearch({ traceId })}
              />
            </div>
          </aside>

          <main className="min-h-0 min-w-0 border-b xl:border-b-0">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b px-3 py-2">
                {isPending ? (
                  <Skeleton className="h-[104px] w-full" />
                ) : summary?.histogram.length ? (
                  <LogHistogram
                    data={summary.histogram}
                    onSelectRange={({ from, to }) => {
                      setSelectedLogState(null);
                      updateSearch({ from, to });
                    }}
                  />
                ) : (
                  <div className="text-muted-foreground flex h-[104px] items-center justify-center rounded-md border border-dashed text-sm">
                    No log volume in this range
                  </div>
                )}
              </div>

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
                    onLoadMore={() => fetchNextPage()}
                    onSelect={(log, key) => setSelectedLogState({ log, key })}
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
          content={
            <ChartTooltipContent
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
  totalCount: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onSelect: (log: LogExplorerRow, key: string) => void;
}) {
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!hasNextPage || isFetchingNextPage) return;
    const target = event.currentTarget;
    const distanceToBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 480) {
      onLoadMore();
    }
  };

  return (
    <div
      className="h-full min-h-0 overflow-auto bg-background"
      onScroll={handleScroll}
    >
      {logs.map((log, index) => {
        const rowKey = `${log.id}:${index}`;
        return (
          <button
            key={rowKey}
            type="button"
            className={cn(
              "group grid w-full grid-cols-[86px_minmax(0,1fr)_28px] gap-2 border-b px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50 md:grid-cols-[112px_minmax(0,1fr)_156px_28px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30",
              selectedLogKey === rowKey && "bg-muted/70 hover:bg-muted/70",
            )}
            onClick={() => onSelect(log, rowKey)}
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-muted-foreground tabular-nums">
                {formatTimestampTimeOfDay(log.timestamp)}
              </span>
              <Badge
                variant="outline"
                className={cn("capitalize", levelBadgeClassName(log.level))}
              >
                {log.level}
              </Badge>
            </div>

            <div className="min-w-0">
              <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1">
                  <Server className="size-3 shrink-0" />
                  <span className="truncate">
                    {log.serviceName || "unknown"}
                  </span>
                </span>
                <span className="hidden min-w-0 items-center gap-1 sm:flex">
                  <Boxes className="size-3 shrink-0" />
                  <span className="truncate">{log.repo || "default"}</span>
                </span>
              </div>
              <div className="max-h-10 overflow-hidden whitespace-pre-wrap break-words font-mono text-[0.75rem] leading-5">
                <Ansi useClasses>{log.body}</Ansi>
              </div>
            </div>

            <div className="hidden min-w-0 flex-col items-end text-muted-foreground md:flex">
              <span className="truncate font-mono">
                {shortIdentifier(log.traceId) || "no trace"}
              </span>
              <span className="truncate font-mono">
                {shortIdentifier(log.spanId) || "no span"}
              </span>
            </div>

            <ChevronRight className="text-muted-foreground mt-1 size-4 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        );
      })}
      <div className="text-muted-foreground flex h-12 items-center justify-center border-b px-3 text-xs">
        {isFetchingNextPage ? (
          <span className="flex items-center gap-2">
            <Skeleton className="size-2 rounded-full" />
            Loading more events
          </span>
        ) : hasNextPage ? (
          <span>
            Showing {logs.length.toLocaleString()} of{" "}
            {totalCount.toLocaleString()} events
          </span>
        ) : (
          <span>
            Showing all {logs.length.toLocaleString()} matching events
          </span>
        )}
      </div>
    </div>
  );
}

function LogInspectorPanel({
  log,
  onClose,
}: {
  log: LogExplorerRow;
  onClose: () => void;
}) {
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

        <DetailSection title="Event">
          <DetailItem
            icon={<Clock3 />}
            label="Timestamp"
            value={log.timestamp}
          />
          <DetailItem
            icon={<Server />}
            label="Service"
            value={log.serviceName}
          />
          <DetailItem label="Severity" value={severityLabel(log)} />
          <DetailItem
            icon={<Boxes />}
            label="Source"
            value={log.repo || "default"}
          />
        </DetailSection>

        <DetailSection title="Correlation">
          <DetailItem
            icon={<Fingerprint />}
            label="Trace ID"
            value={log.traceId}
            mono
          />
          <DetailItem label="Span ID" value={log.spanId} mono />
        </DetailSection>

        {hasCiContext(log) ? (
          <DetailSection title="CI/CD">
            <DetailItem
              icon={<GitBranch />}
              label="Branch"
              value={log.branch}
            />
            <DetailItem label="Pipeline" value={log.workflowName} />
            <DetailItem label="Execution ID" value={log.runId} mono />
            <DetailItem label="Task" value={log.jobName || log.jobId} />
            <DetailItem label="Step" value={log.stepNumber} />
            {log.traceId ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-fit"
                render={
                  <Link to="/runs/$traceId" params={{ traceId: log.traceId }} />
                }
              >
                <FileSearch data-icon="inline-start" />
                Open trace detail
              </Button>
            ) : null}
          </DetailSection>
        ) : null}
      </div>
    </div>
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

function severityLabel(log: LogExplorerRow) {
  if (log.severityText) return log.severityText;
  if (log.severityNumber > 0) return String(log.severityNumber);
  return "N/A";
}

function shortIdentifier(value?: string) {
  if (!value) return "";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function hasCiContext(log: LogExplorerRow) {
  return Boolean(
    log.branch ||
      log.workflowName ||
      log.runId ||
      log.jobId ||
      log.jobName ||
      log.stepNumber,
  );
}

function levelBadgeClassName(level: LogLevel) {
  return LOG_LEVEL_META[level].badgeClassName;
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

function LogsExplorerSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="flex h-full min-h-[720px] flex-col overflow-hidden">
        <div className="border-b px-3 py-2">
          <Skeleton className="mb-2 h-8 w-64" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_360px]">
          <div className="border-b p-3 lg:border-r lg:border-b-0">
            <Skeleton className="mb-3 h-5 w-24" />
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          </div>
          <div className="min-h-0">
            <div className="border-b p-3">
              <Skeleton className="mb-2 h-8 w-full" />
              <Skeleton className="h-[104px] w-full" />
            </div>
            <LogRowsSkeleton />
          </div>
          <div className="hidden border-l p-3 xl:block">
            <Skeleton className="mb-3 h-10 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </section>
    </div>
  );
}
