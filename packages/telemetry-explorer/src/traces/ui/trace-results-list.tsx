import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { formatDuration } from "@everr/ui/lib/formatting";
import {
  formatRelativeTime,
  formatTimestampTimeOfDay,
  parseTimestampAsUTC,
} from "@everr/ui/lib/timestamp";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { TraceSummary } from "../data/types";
import { addNsToCHDateTime } from "../data/window";
import { useDelayedFlag } from "../util/use-delayed-flag";
import { DurationBar } from "./duration-bar";
import { serviceColor } from "./shared/service-color";

const SKELETON_DELAY_MS = 1000;
const VIRTUOSO_OVERSCAN = 600;

type Props = {
  rows: TraceSummary[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  renderTraceLink: (props: TraceLinkRenderProps) => ReactNode;
  onLoadMore: () => void;
  onClearFilters: () => void;
};

export type TraceLinkRenderProps = {
  traceId: string;
  start: string;
  end: string;
  className: string;
  children: ReactNode;
};

export function TraceResultsList({
  rows,
  isPending,
  isError,
  error,
  refetch,
  hasMore,
  isLoadingMore,
  renderTraceLink,
  onLoadMore,
  onClearFilters,
}: Props) {
  const maxDuration = useMemo(() => {
    let max = 0n;
    for (const r of rows) {
      const d = BigInt(r.durationNs);
      if (d > max) max = d;
    }
    return max;
  }, [rows]);

  const endReached = useCallback(() => {
    if (hasMore && !isLoadingMore) onLoadMore();
  }, [hasMore, isLoadingMore, onLoadMore]);

  const itemContent = useCallback(
    (_index: number, row: TraceSummary) => (
      <TraceRow
        row={row}
        maxDuration={maxDuration}
        renderTraceLink={renderTraceLink}
      />
    ),
    [maxDuration, renderTraceLink],
  );

  const components = useMemo(
    () => ({
      Footer: () => (
        <ResultsFooter
          count={rows.length}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
        />
      ),
    }),
    [rows.length, hasMore, isLoadingMore],
  );

  const showSkeleton = useDelayedFlag(isPending, SKELETON_DELAY_MS);
  if (isPending) return showSkeleton ? <ResultsSkeleton /> : null;
  if (isError) {
    return (
      <RetryError
        title="Failed to load traces"
        message={error?.message ?? "Unknown error"}
        onRetry={refetch}
      />
    );
  }
  if (rows.length === 0) {
    return <EmptyState onClearFilters={onClearFilters} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ResultsHeader />
      <Virtuoso
        className="min-h-0 flex-1"
        data={rows}
        increaseViewportBy={VIRTUOSO_OVERSCAN}
        endReached={endReached}
        computeItemKey={(_, row) => row.traceId}
        itemContent={itemContent}
        components={components}
      />
    </div>
  );
}

function ResultsHeader() {
  return (
    <div className="text-muted-foreground bg-background flex items-center gap-3 border-b px-3 py-1.5 text-xs font-medium">
      <span className="size-2 shrink-0" />
      <span className="min-w-0 flex-1">Trace</span>
      <span className="w-32 text-right">Duration</span>
      <span className="hidden w-14 text-right md:inline">Spans</span>
      <span className="hidden w-20 text-right lg:inline">Started</span>
    </div>
  );
}

function TraceRow({
  row,
  maxDuration,
  renderTraceLink,
}: {
  row: TraceSummary;
  maxDuration: bigint;
  renderTraceLink: (props: TraceLinkRenderProps) => React.ReactNode;
}) {
  const end = addNsToCHDateTime(row.startTs, BigInt(row.durationNs));
  const className =
    "hover:bg-muted/50 flex items-center gap-3 border-b px-3 py-1.5 text-sm leading-tight";
  const started = parseTimestampAsUTC(row.startTs);
  return renderTraceLink({
    traceId: row.traceId,
    start: row.startTs,
    end,
    className,
    children: (
      <>
        <span
          className="size-2 shrink-0 rounded-full"
          style={{
            backgroundColor: serviceColor(row.rootNamespace, row.rootService),
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 leading-tight">
            {row.errorCount > 0 && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      role="img"
                      aria-label={`${row.errorCount} ${
                        row.errorCount === 1 ? "error" : "errors"
                      }`}
                      className="text-destructive flex shrink-0 items-center"
                    />
                  }
                >
                  <TriangleAlert className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>
                  {row.errorCount} {row.errorCount === 1 ? "error" : "errors"}
                </TooltipContent>
              </Tooltip>
            )}
            <span className="truncate font-medium">{row.rootName}</span>
            <TraceIdBadge traceId={row.traceId} />
          </div>
          <div className="text-muted-foreground truncate text-xs leading-tight">
            {row.rootService}
          </div>
        </div>
        <div className="flex w-32 shrink-0 flex-col items-end gap-1">
          <span className="tabular-nums">
            {formatDuration(Number(row.durationNs), "ns")}
          </span>
          <DurationBar
            durationNs={BigInt(row.durationNs)}
            maxDurationNs={maxDuration}
          />
        </div>
        <span className="text-muted-foreground hidden w-14 text-right text-xs tabular-nums md:inline">
          {row.spanCount} {row.spanCount === 1 ? "span" : "spans"}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="text-muted-foreground hidden w-20 text-right text-xs tabular-nums lg:inline" />
            }
          >
            {formatTimestampTimeOfDay(row.startTs)}
          </TooltipTrigger>
          <TooltipContent side="left">
            {started ? (
              <span className="flex flex-col gap-0.5">
                <span className="tabular-nums">{started.toLocaleString()}</span>
                <span className="text-background/70">
                  {formatRelativeTime(row.startTs)}
                </span>
              </span>
            ) : (
              row.startTs
            )}
          </TooltipContent>
        </Tooltip>
      </>
    ),
  });
}

function TraceIdBadge({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);
  const short = traceId.slice(0, 8);

  // The whole row is wrapped in a link, so stop the click from navigating or
  // bubbling to the router before copying the full id to the clipboard.
  const copy = (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard?.writeText(traceId).then(() => setCopied(true));
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // biome-ignore lint/a11y/useSemanticElements: A button would nest inside the row's anchor.
          <span
            role="button"
            tabIndex={0}
            aria-label="Copy trace ID"
            className="text-muted-foreground hover:text-foreground group inline-flex shrink-0 cursor-pointer items-center gap-1 font-mono text-xs font-normal"
            onClick={copy}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") copy(event);
            }}
            onMouseLeave={() => setCopied(false)}
          />
        }
      >
        {short}
        {copied ? (
          <Check className="size-3" />
        ) : (
          <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-70" />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {copied ? "Copied!" : <span className="font-mono">{traceId}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

function ResultsFooter({
  count,
  hasMore,
  isLoadingMore,
}: {
  count: number;
  hasMore: boolean;
  isLoadingMore: boolean;
}) {
  return (
    <div className="text-muted-foreground flex h-10 items-center justify-center px-3 text-xs">
      {isLoadingMore ? (
        <span className="flex items-center gap-2">
          <Skeleton className="size-2 rounded-full" />
          Loading more traces
        </span>
      ) : hasMore ? (
        <span>Showing {count.toLocaleString()} traces</span>
      ) : (
        <span>Showing all {count.toLocaleString()} matching traces</span>
      )}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b px-3 py-1.5">
          <Skeleton className="size-2 shrink-0 rounded-full" />
          <Skeleton className="h-4 min-w-0 flex-1" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="hidden h-3 w-14 lg:block" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No traces</EmptyTitle>
        <EmptyDescription>
          No traces match the current filters.
        </EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" onClick={onClearFilters}>
        Clear filters
      </Button>
    </Empty>
  );
}
