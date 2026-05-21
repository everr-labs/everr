import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import type { UseQueryResult } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import type { TraceSummary } from "../data/types";
import { addNsToCHDateTime } from "../data/window";
import { formatDuration } from "../util/formatting";
import { useDelayedFlag } from "../util/use-delayed-flag";
import { DurationBar } from "./duration-bar";
import { serviceColor } from "./shared/service-color";

const SKELETON_DELAY_MS = 1000;

type Props = {
  query: UseQueryResult<TraceSummary[]>;
  limit: number;
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
  query,
  limit,
  renderTraceLink,
  onLoadMore,
  onClearFilters,
}: Props) {
  const rows = query.data ?? [];
  const maxDuration = useMemo(() => {
    let max = 0n;
    for (const r of rows) {
      const d = BigInt(r.durationNs);
      if (d > max) max = d;
    }
    return max;
  }, [rows]);

  const showSkeleton = useDelayedFlag(query.isPending, SKELETON_DELAY_MS);
  if (query.isPending) return showSkeleton ? <ResultsSkeleton /> : null;
  if (query.isError) {
    return (
      <ErrorState
        message={(query.error as Error).message}
        onRetry={() => query.refetch()}
      />
    );
  }
  if (rows.length === 0) {
    return <EmptyState onClearFilters={onClearFilters} />;
  }

  const isLoadingMore = query.isFetching && query.isPlaceholderData;
  const hasMore = rows.length >= limit || isLoadingMore;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Virtuoso
        className="flex-1"
        data={rows}
        itemContent={(_, row) => (
          <TraceRow
            row={row}
            maxDuration={maxDuration}
            renderTraceLink={renderTraceLink}
          />
        )}
      />
      {hasMore && (
        <div className="flex justify-center border-t py-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground text-xs"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "Loading more..." : "Load more"}
          </Button>
        </div>
      )}
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

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Failed to load traces</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </Empty>
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
