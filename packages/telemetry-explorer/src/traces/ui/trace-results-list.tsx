import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { RetryError } from "@everr/ui/components/retry-error";
import { virtuosoScrollAreaComponents } from "@everr/ui/components/scroll-area";
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
import { cn } from "@everr/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { TraceSummary } from "../data/types";
import { addNsToCHDateTime } from "../data/window";
import { useDelayedFlag } from "../util/use-delayed-flag";
import { DurationBar } from "./duration-bar";
import { isSafeMethod, splitSpanName } from "./http-method";
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
      ...virtuosoScrollAreaComponents,
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
    <div className="text-muted-foreground bg-background flex items-center gap-2 border-b px-3 py-1.5 text-xs font-medium">
      <span className="min-w-0 flex-1">Trace</span>
      <span className="hidden w-28 shrink-0 md:inline">Service</span>
      <span className="w-24 text-right">Duration</span>
      <span className="hidden w-16 text-right md:inline">Status</span>
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
  const name = splitSpanName(row.rootName);
  // The link wraps only the name but its `after` pseudo-element stretches over
  // the whole row, so the entire row navigates while the copy control and
  // tooltips stay as siblings (lifted above the overlay with z-10) instead of
  // nested interactive elements inside the anchor.
  return (
    <div className="hover:bg-muted/50 relative flex items-center gap-2 border-b px-3 py-1.5 text-sm leading-tight">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 leading-tight">
        {renderTraceLink({
          traceId: row.traceId,
          start: row.startTs,
          end,
          className:
            "flex min-w-0 items-center gap-1.5 font-medium after:absolute after:inset-0 after:content-['']",
          children: (
            <>
              {name.method && <HttpMethodBadge method={name.method} />}
              {/* A space character, and not only the flex gap. Without it the
                    accessible name becomes "POST/api/users". A run of space
                    characters is not a flex item, so the layout does not
                    change. */}
              {name.method && name.label ? " " : null}
              {name.label && <span className="truncate">{name.label}</span>}
            </>
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
        <span className="tabular-nums">
          {formatDuration(Number(row.durationNs), "ns")}
        </span>
        <DurationBar
          durationNs={BigInt(row.durationNs)}
          maxDurationNs={maxDuration}
        />
      </div>
      <span className="hidden w-16 justify-end md:flex">
        <TraceStatusBadge
          errorCount={row.errorCount}
          statusCode={row.rootStatusCode}
        />
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
              <span className="text-background/70">
                {formatRelativeTime(row.startTs)}
              </span>
            </span>
          ) : (
            row.startTs
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// Two tones for nine methods. The methods that read share one tone, and the
// methods that change state share the other. The badge always shows the method
// as text, so colour is never the only signal. The tints use the same 400-shade
// text on a light fill as the status tones in the Badge component, which are
// set for the dark surfaces of the app.
function HttpMethodBadge({ method }: { method: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 rounded px-1 font-mono tracking-wide",
        isSafeMethod(method)
          ? "border-sky-500/40 bg-sky-500/10 text-sky-400"
          : "border-amber-500/40 bg-amber-500/10 text-amber-400",
      )}
    >
      {method}
    </Badge>
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
function TraceStatusBadge({
  errorCount,
  statusCode,
}: {
  errorCount: number;
  statusCode: string;
}) {
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
      className={cn(
        "rounded px-1.5 font-mono",
        failed
          ? "border-red-500/40 bg-red-500/10 text-red-400"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
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
        <div key={i} className="flex items-center gap-2 border-b px-3 py-1.5">
          <Skeleton className="h-4 min-w-0 flex-1" />
          <Skeleton className="hidden h-3 w-28 md:block" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="hidden h-3 w-16 lg:block" />
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
