import { Spinner } from "@everr/ui/components/spinner";
import { Badge } from "@everr/ui/components/badge";
import { RetryError } from "@everr/ui/components/retry-error";
import {
  virtuosoInitialItemCount,
  virtuosoScrollAreaComponents,
} from "@everr/ui/components/scroll-area";
import { raggedWidth, Skeleton, SkeletonLine } from "@everr/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { formatDuration } from "@everr/ui/lib/formatting";
import {
  formatRelativeTime,
  formatRowTimestamp,
  parseTimestampAsUTC,
} from "@everr/ui/lib/timestamp";
import { cn } from "@everr/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { TraceSummary } from "../data/types";
import { showingAll } from "../../filters/ui/no-results";
import { lastOpenedRow } from "../../shell/use-last-opened";
import { useOwnScrollPosition } from "../../shell/use-own-scroll-position";
import { DurationBar } from "./duration-bar";
import { serviceColor } from "./shared/service-color";
import { SpanName } from "./span-name";

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
  /** What shows when nothing matches. */
  empty: ReactNode;
  /** Show the day with the start time: the list covers more than one day. */
  withDay?: boolean;
  lastOpenedTraceId?: string;
};

export type TraceLinkRenderProps = {
  traceId: string;
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
  empty,
  withDay = false,
  lastOpenedTraceId,
}: Props) {
  const maxDuration = useMemo(() => {
    let max = 0n;
    for (const r of rows) {
      const d = BigInt(r.durationNs);
      if (d > max) max = d;
    }
    return max;
  }, [rows]);

  const ownScroll = useOwnScrollPosition();

  const endReached = useCallback(() => {
    if (hasMore && !isLoadingMore) onLoadMore();
  }, [hasMore, isLoadingMore, onLoadMore]);

  const itemContent = useCallback(
    (_index: number, row: TraceSummary) => (
      <TraceRow
        row={row}
        maxDuration={maxDuration}
        renderTraceLink={renderTraceLink}
        withDay={withDay}
        lastOpened={row.traceId === lastOpenedTraceId}
      />
    ),
    [maxDuration, renderTraceLink, withDay, lastOpenedTraceId],
  );

  const components = useMemo(
    () => ({
      ...virtuosoScrollAreaComponents,
      // oxlint-disable-next-line react/no-unstable-nested-components -- Preserve the existing footer component lifetime when pagination values change.
      Footer: () => (
        <ResultsFooter count={rows.length} hasMore={hasMore} isLoadingMore={isLoadingMore} />
      ),
    }),
    [rows.length, hasMore, isLoadingMore],
  );

  if (isPending) return <ResultsSkeleton withDay={withDay} />;
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
    return empty;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ResultsHeader withDay={withDay} />
      <Virtuoso
        className="min-h-0 flex-1"
        scrollerRef={ownScroll}
        data={rows}
        initialItemCount={virtuosoInitialItemCount(rows.length)}
        increaseViewportBy={VIRTUOSO_OVERSCAN}
        endReached={endReached}
        computeItemKey={(_, row) => row.traceId}
        itemContent={itemContent}
        components={components}
      />
    </div>
  );
}

function ResultsHeader({ withDay }: { withDay: boolean }) {
  return (
    <div className="text-muted-foreground bg-background flex items-center gap-2 border-b px-3 py-1.5 text-xs font-medium">
      <span className="min-w-0 flex-1">Trace</span>
      <span className="hidden w-28 shrink-0 md:inline">Service</span>
      <span className="w-24 text-right">Duration</span>
      <span className="hidden w-16 text-right md:inline">Status</span>
      <span className={cn("hidden text-right lg:inline", withDay ? "w-36" : "w-20")}>Started</span>
    </div>
  );
}

function TraceRow({
  row,
  maxDuration,
  renderTraceLink,
  withDay,
  lastOpened,
}: {
  row: TraceSummary;
  maxDuration: bigint;
  renderTraceLink: (props: TraceLinkRenderProps) => React.ReactNode;
  withDay: boolean;
  lastOpened: boolean;
}) {
  const started = parseTimestampAsUTC(row.startTs);
  // The link wraps only the name but its `after` pseudo-element stretches over
  // the whole row, so the entire row navigates while the copy control and
  // tooltips stay as siblings (lifted above the overlay with z-10) instead of
  // nested interactive elements inside the anchor.
  return (
    <div
      data-last-opened={lastOpened || undefined}
      className={cn(
        "hover:bg-muted/50 relative flex h-10 items-center gap-2 border-b px-3 text-sm leading-tight",
        lastOpenedRow,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 leading-tight">
        {renderTraceLink({
          traceId: row.traceId,
          className:
            "flex min-w-0 items-center gap-1.5 font-medium after:absolute after:inset-0 after:content-['']",
          children: (
            <SpanName
              name={row.rootName}
              methodClassName="w-11 shrink-0"
              labelClassName="truncate"
            />
          ),
        })}
        <TraceIdBadge traceId={row.traceId} />
      </div>

      {/* A fixed width, and shrink-0, so that the services stay in one line
          down the list and the user can compare them. A long trace name must
          not make this column narrower. A name longer than 112px ends with an
          ellipsis, and the full name is available on hover. */}
      <div className="text-muted-foreground hidden w-28 shrink-0 items-center gap-1.5 text-xs md:flex">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{
            backgroundColor: serviceColor(row.rootService),
          }}
        />
        <span className="min-w-0 truncate" title={row.rootService}>
          {row.rootService}
        </span>
      </div>

      <div className="flex w-24 shrink-0 flex-col items-end gap-1">
        <span className="tabular-nums">{formatDuration(Number(row.durationNs), "ns")}</span>
        <DurationBar durationNs={BigInt(row.durationNs)} maxDurationNs={maxDuration} />
      </div>
      <span className="hidden w-16 justify-end md:flex">
        <TraceStatusBadge errorCount={row.errorCount} statusCode={row.rootStatusCode} />
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                "text-muted-foreground relative z-10 hidden text-right text-xs tabular-nums lg:inline",
                withDay ? "w-36" : "w-20",
              )}
            />
          }
        >
          {formatRowTimestamp(row.startTs, withDay)}
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

// The badge shows the response code of an HTTP root span. For any other span it
// shows OK or Error.
//
// The colour does not come from the code. It comes from the trace: the badge is
// red when any span in the trace has an error. This is the same rule as the
// Status filter, `countIf(StatusCode = 'Error') > 0`. A filter on Error
// therefore never returns a green row, and a 404 that the service handles
// stays green.
function TraceStatusBadge({ errorCount, statusCode }: { errorCount: number; statusCode: string }) {
  const failed = errorCount > 0;
  const errorLabel = failed
    ? `${errorCount} ${errorCount === 1 ? "error" : "errors"}`
    : "No errors";
  return (
    <Badge
      variant="outline"
      // The code alone does not show whether the trace failed. The label gives
      // that state as text for a user who cannot see the colour.
      aria-label={statusCode ? `${statusCode}, ${errorLabel}` : errorLabel}
      // Only a failure gets a chip. A healthy trace is the norm, so its code
      // stays plain text and the failures stand out in the column.
      className={cn(
        "rounded px-1.5 font-mono",
        failed
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-transparent bg-transparent text-muted-foreground",
      )}
    >
      {statusCode || (failed ? "Error" : "OK")}
    </Badge>
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
          <Spinner className="size-3" />
          Loading more traces
        </span>
      ) : hasMore ? (
        <span>Showing {count.toLocaleString()} traces</span>
      ) : (
        <span>{showingAll(count, "trace")}</span>
      )}
    </div>
  );
}

/** About a tall screen of rows. No more: every bar repaints its shimmer each frame. */
const SKELETON_ROW_COUNT = 30;

// Built from `TraceRow`'s own cells, so nothing moves when the traces land.
function ResultsSkeleton({ withDay }: { withDay: boolean }) {
  return (
    <div aria-hidden className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ResultsHeader withDay={withDay} />
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
        <div
          key={i}
          className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-sm leading-tight"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <SkeletonLine className="w-11 shrink-0">
              <Skeleton className="h-2.5 w-7 rounded-sm" />
            </SkeletonLine>
            <SkeletonLine className="min-w-0 flex-1">
              <Skeleton className="h-3.5 rounded-sm" style={{ width: raggedWidth(i, 22, 58) }} />
            </SkeletonLine>
          </div>
          <div className="hidden w-28 shrink-0 items-center gap-1.5 text-xs md:flex">
            <Skeleton className="size-2 shrink-0 rounded-full" />
            <SkeletonLine>
              <Skeleton className="h-3 w-20 rounded-sm" />
            </SkeletonLine>
          </div>
          <div className="flex w-24 shrink-0 flex-col items-end gap-1">
            <SkeletonLine>
              <Skeleton className="h-3.5 w-12 rounded-sm" />
            </SkeletonLine>
            <Skeleton className="h-1.5 w-full rounded" />
          </div>
          {/* The status badge's own height. */}
          <span className="hidden h-5 w-16 items-center justify-end md:flex">
            <Skeleton className="h-3 w-8 rounded-sm" />
          </span>
          <span className={cn("hidden justify-end text-xs lg:flex", withDay ? "w-36" : "w-20")}>
            <SkeletonLine>
              <Skeleton className={cn("h-3 rounded-sm", withDay ? "w-32" : "w-16")} />
            </SkeletonLine>
          </span>
        </div>
      ))}
    </div>
  );
}
