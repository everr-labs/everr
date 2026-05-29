import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { formatDuration } from "@everr/ui/lib/formatting";
import { type ReactNode, useCallback, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import type { TraceSummary } from "../data/types";
import { addNsToCHDateTime } from "../data/window";
import { useDelayedFlag } from "../util/use-delayed-flag";
import { DurationBar } from "./duration-bar";
import { serviceColor } from "./shared/service-color";

const SKELETON_DELAY_MS = 1000;

type Props = {
  traces: TraceSummary[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  onRetry: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  renderTraceLink: (props: TraceLinkRenderProps) => ReactNode;
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
  traces,
  isPending,
  isError,
  error,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  renderTraceLink,
  onClearFilters,
}: Props) {
  const maxDuration = useMemo(() => {
    let max = 0n;
    for (const r of traces) {
      const d = BigInt(r.durationNs);
      if (d > max) max = d;
    }
    return max;
  }, [traces]);

  const endReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) onLoadMore();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  const components = useMemo(
    () => ({
      Footer: () => (
        <div className="text-muted-foreground flex h-12 items-center justify-center px-3 text-xs">
          {isFetchingNextPage ? (
            <span className="flex items-center gap-2">
              <Skeleton className="size-2 rounded-full" />
              Loading more traces
            </span>
          ) : hasNextPage ? (
            <span>Showing {traces.length.toLocaleString()} traces</span>
          ) : (
            <span>
              Showing all {traces.length.toLocaleString()} matching traces
            </span>
          )}
        </div>
      ),
    }),
    [isFetchingNextPage, hasNextPage, traces.length],
  );

  const showSkeleton = useDelayedFlag(isPending, SKELETON_DELAY_MS);
  if (isPending) return showSkeleton ? <ResultsSkeleton /> : null;
  if (isError) {
    return (
      <RetryError
        title="Failed to load traces"
        message={error?.message ?? "Unknown error"}
        onRetry={onRetry}
      />
    );
  }
  if (traces.length === 0) {
    return <EmptyState onClearFilters={onClearFilters} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Virtuoso
        className="flex-1"
        data={traces}
        endReached={endReached}
        components={components}
        itemContent={(_, row) => (
          <TraceRow
            row={row}
            maxDuration={maxDuration}
            renderTraceLink={renderTraceLink}
          />
        )}
      />
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
    "hover:bg-muted/50 flex items-center gap-3 border-b px-3 py-2";
  return renderTraceLink({
    traceId: row.traceId,
    start: row.startTs,
    end,
    className,
    children: (
      <>
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            backgroundColor: serviceColor(row.rootNamespace, row.rootService),
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{row.rootName}</div>
          <div className="text-muted-foreground truncate text-xs">
            {row.rootService}
          </div>
        </div>
        <DurationBar
          durationNs={BigInt(row.durationNs)}
          maxDurationNs={maxDuration}
        />
        <div className="w-20 text-right text-sm tabular-nums">
          {formatDuration(Number(row.durationNs), "ns")}
        </div>
        <div className="text-muted-foreground w-16 text-right text-xs">
          {row.spanCount} spans
        </div>
        {row.errorCount > 0 ? (
          <span className="text-destructive w-16 text-right text-xs">
            {row.errorCount} err
          </span>
        ) : (
          <span className="w-16" />
        )}
      </>
    ),
  });
}

function ResultsSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
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
