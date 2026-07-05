import { Button } from "@everr/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@everr/ui/components/empty";
import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
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
      <TraceRow row={row} maxDuration={maxDuration} renderTraceLink={renderTraceLink} />
    ),
    [maxDuration, renderTraceLink],
  );

  const components = useMemo(
    () => ({
      Footer: () => (
        <ResultsFooter count={rows.length} hasMore={hasMore} isLoadingMore={isLoadingMore} />
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
  const started = parseTimestampAsUTC(row.startTs);
  // The link wraps only the name but its `after` pseudo-element stretches over
  // the whole row, so the entire row navigates while the copy control and
  // tooltips stay as siblings (lifted above the overlay with z-10) instead of
  // nested interactive elements inside the anchor.
  return (
    <div className="hover:bg-muted/50 relative flex items-center gap-3 border-b px-3 py-1.5 text-sm leading-tight">
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
                    aria-label={`${row.errorCount} ${row.errorCount === 1 ? "error" : "errors"}`}
                    className="text-destructive relative z-10 flex shrink-0 items-center"
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
          {renderTraceLink({
            traceId: row.traceId,
            start: row.startTs,
            end,
            className:
              "min-w-0 truncate font-medium after:absolute after:inset-0 after:content-['']",
            children: row.rootName,
          })}
          <TraceIdBadge traceId={row.traceId} />
        </div>
        <div className="text-muted-foreground truncate text-xs leading-tight">
          {row.rootService}
        </div>
      </div>
      <div className="flex w-32 shrink-0 flex-col items-end gap-1">
        <span className="tabular-nums">{formatDuration(Number(row.durationNs), "ns")}</span>
        <DurationBar durationNs={BigInt(row.durationNs)} maxDurationNs={maxDuration} />
      </div>
      <span className="text-muted-foreground hidden w-14 text-right text-xs tabular-nums md:inline">
        {row.spanCount} {row.spanCount === 1 ? "span" : "spans"}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="text-muted-foreground relative z-10 hidden w-20 text-right text-xs tabular-nums lg:inline" />
          }
        >
          {formatTimestampTimeOfDay(row.startTs)}
        </TooltipTrigger>
        <TooltipContent side="left">
          {started ? (
            <span className="flex flex-col gap-0.5">
              <span className="tabular-nums">{started.toLocaleString()}</span>
              <span className="text-background/70">{formatRelativeTime(row.startTs)}</span>
            </span>
          ) : (
            row.startTs
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function TraceIdBadge({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);
  const short = traceId.slice(0, 8);

  // The badge sits above the row's stretched link overlay, but still guard the
  // click so copying never navigates or bubbles to the router.
  const copy = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard?.writeText(traceId).then(() => setCopied(true));
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Copy trace ID"
            className="text-muted-foreground hover:text-foreground group relative z-10 inline-flex shrink-0 cursor-pointer items-center gap-1 font-mono text-xs font-normal"
            onClick={copy}
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
        // oxlint-disable-next-line react/no-array-index-key -- static placeholder skeleton list with no data-backed key
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
        <EmptyDescription>No traces match the current filters.</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" onClick={onClearFilters}>
        Clear filters
      </Button>
    </Empty>
  );
}
