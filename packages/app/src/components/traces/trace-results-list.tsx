import { Button } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Virtuoso } from "react-virtuoso";
import type { TraceSummary } from "@/data/traces/types";
import { addNsToCHDateTime } from "@/data/traces/window";
import { DurationBar } from "./duration-bar";
import { formatDurationNs } from "./shared/format-duration";
import { serviceColor } from "./shared/service-color";

type Props = {
  query: UseQueryResult<TraceSummary[]>;
  onLoadMore: () => void;
  onClearFilters: () => void;
};

export function TraceResultsList({ query, onLoadMore, onClearFilters }: Props) {
  if (query.isPending) return <ResultsSkeleton />;
  if (query.isError) {
    return (
      <ErrorCard
        message={(query.error as Error).message}
        onRetry={() => query.refetch()}
      />
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <EmptyState onClearFilters={onClearFilters} />;
  }

  let maxDuration = 0n;
  for (const r of rows) {
    const d = BigInt(r.durationNs);
    if (d > maxDuration) maxDuration = d;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Virtuoso
        className="flex-1"
        data={rows}
        itemContent={(_, row) => (
          <TraceRow row={row} maxDuration={maxDuration} />
        )}
      />
      <div className="flex justify-center border-t py-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground text-xs"
          onClick={onLoadMore}
        >
          Load more
        </Button>
      </div>
    </div>
  );
}

function TraceRow({
  row,
  maxDuration,
}: {
  row: TraceSummary;
  maxDuration: bigint;
}) {
  return (
    <Link
      to="/traces/$traceId"
      params={{ traceId: row.traceId }}
      search={(prev) => ({
        ...prev,
        tab: "timeline" as const,
        start: row.startTs,
        end: addNsToCHDateTime(row.startTs, BigInt(row.durationNs)),
      })}
      className="hover:bg-muted/50 flex items-center gap-3 border-b px-3 py-2"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor: serviceColor("", row.rootService),
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
        {formatDurationNs(row.durationNs)}
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
    </Link>
  );
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

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-2 rounded-md border p-4">
      <div className="text-destructive text-sm font-medium">
        Failed to load traces
      </div>
      <div className="text-muted-foreground text-xs">{message}</div>
      <div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 py-12 text-sm">
      <div>No traces match the current filters.</div>
      <Button variant="outline" size="sm" onClick={onClearFilters}>
        Clear filters
      </Button>
    </div>
  );
}
