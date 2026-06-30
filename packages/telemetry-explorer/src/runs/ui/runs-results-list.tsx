import { Badge } from "@everr/ui/components/badge";
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
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Virtuoso } from "react-virtuoso";
import { useDelayedFlag } from "../../traces/util/use-delayed-flag";
import type { RunListItem } from "../schemas";
import { ConclusionIcon } from "./conclusion-icon";
import { SenderCell } from "./sender-cell";

const VIRTUOSO_OVERSCAN = 600;
const SKELETON_DELAY_MS = 600;

// Runs are timed to the second (and the live timer ticks every second), so
// render whole seconds — `Xs` under a minute, `Ym Zs` above — rather than the
// sub-second tenths the shared formatDuration shows.
function formatRunDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/** Wraps the run's workflow name; its stretched overlay makes the row activate. */
export type RenderRunLink = (ctx: {
  run: RunListItem;
  className: string;
  children: ReactNode;
}) => ReactNode;

/** Optional trailing actions per row (e.g. copy auto-fix prompt). */
export type RenderRunRowActions = (run: RunListItem) => ReactNode;

interface RunsResultsListProps {
  runs: RunListItem[];
  totalCount?: number;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onClearFilters: () => void;
  renderRunLink: RenderRunLink;
  renderRowActions?: RenderRunRowActions;
}

export function RunsResultsList({
  runs,
  totalCount,
  isPending,
  isError,
  error,
  refetch,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onClearFilters,
  renderRunLink,
  renderRowActions,
}: RunsResultsListProps) {
  const endReached = useCallback(() => {
    if (hasMore && !isLoadingMore) onLoadMore();
  }, [hasMore, isLoadingMore, onLoadMore]);

  const itemContent = useCallback(
    (_index: number, run: RunListItem) => (
      <RunRow
        run={run}
        renderRunLink={renderRunLink}
        renderRowActions={renderRowActions}
      />
    ),
    [renderRunLink, renderRowActions],
  );

  const components = useMemo(
    () => ({
      Footer: () => (
        <ResultsFooter
          count={runs.length}
          totalCount={totalCount}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
        />
      ),
    }),
    [runs.length, totalCount, hasMore, isLoadingMore],
  );

  const showSkeleton = useDelayedFlag(isPending, SKELETON_DELAY_MS);
  if (isPending) return showSkeleton ? <ResultsSkeleton /> : null;
  // Only blank the view when there's nothing to show. A failed `fetchNextPage`
  // flips `isError` while keeping the already-loaded pages, so we keep the list
  // mounted and let the user retry by scrolling rather than wiping it.
  if (isError && runs.length === 0) {
    return (
      <RetryError
        title="Failed to load runs"
        message={error?.message ?? "Unknown error"}
        onRetry={refetch}
      />
    );
  }
  if (runs.length === 0) {
    return <EmptyState onClearFilters={onClearFilters} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ResultsHeader hasActions={Boolean(renderRowActions)} />
      <Virtuoso
        className="min-h-0 flex-1"
        data={runs}
        increaseViewportBy={VIRTUOSO_OVERSCAN}
        endReached={endReached}
        computeItemKey={(_, run) => run.traceId}
        itemContent={itemContent}
        components={components}
      />
    </div>
  );
}

function ResultsHeader({ hasActions }: { hasActions: boolean }) {
  return (
    <div className="text-muted-foreground bg-background flex items-center gap-3 border-b px-3 py-1.5 text-xs font-medium">
      <span className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">Run</span>
      <span className="w-20 text-right">Duration</span>
      <span className="w-24 text-right">When</span>
      {hasActions ? <span className="w-7 shrink-0" /> : null}
    </div>
  );
}

function RunRow({
  run,
  renderRunLink,
  renderRowActions,
}: {
  run: RunListItem;
  renderRunLink: RenderRunLink;
  renderRowActions?: RenderRunRowActions;
}) {
  return (
    <div className="hover:bg-muted/50 relative flex items-center gap-3 border-b px-3 py-2 text-sm leading-tight">
      <ConclusionIcon conclusion={run.conclusion} className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 leading-tight">
          {renderRunLink({
            run,
            className:
              "min-w-0 truncate font-medium after:absolute after:inset-0 after:content-['']",
            children: run.workflowName,
          })}
          {run.runAttempt > 1 ? (
            <span className="text-muted-foreground shrink-0 font-mono text-xs">
              attempt #{run.runAttempt}
            </span>
          ) : null}
        </div>
        {/* min-w-0 + overflow-hidden keeps a long branch/sender from bleeding
            into the trailing columns; the densest fields drop off first as the
            row narrows. */}
        <div className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs leading-tight">
          <span className="shrink-0 font-mono">#{run.runId}</span>
          <Separator />
          <span className="truncate">{run.repo}</span>
          <span className="hidden shrink-0 items-center gap-1.5 sm:inline-flex">
            <Separator />
            <Badge
              variant="outline"
              className="max-w-[12rem] truncate font-normal"
            >
              {run.branch}
            </Badge>
          </span>
          {run.sender ? (
            <span className="hidden shrink-0 items-center gap-1.5 md:inline-flex">
              <Separator />
              <SenderCell sender={run.sender} className="relative z-10" />
            </span>
          ) : null}
        </div>
      </div>
      <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums">
        {run.runningSince ? (
          <LiveDuration startedAt={run.runningSince} />
        ) : run.duration > 0 ? (
          formatRunDuration(run.duration)
        ) : (
          "—"
        )}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="text-muted-foreground relative z-10 w-24 shrink-0 text-right text-xs tabular-nums" />
          }
        >
          {formatRelativeTime(run.timestamp)}
        </TooltipTrigger>
        {/* Anchor above and to the end so it sits over the right-aligned value
            instead of floating across the wide cell into the Duration column. */}
        <TooltipContent side="top" align="end">
          {new Date(run.timestamp).toLocaleString()}
        </TooltipContent>
      </Tooltip>
      {renderRowActions ? (
        <div className="relative z-10 flex w-7 shrink-0 items-center justify-end">
          {renderRowActions(run)}
        </div>
      ) : null}
    </div>
  );
}

// A faint inline divider between subtitle fields.
function Separator() {
  return <span className="text-border shrink-0">·</span>;
}

// Ticks the elapsed time once a second for a run that's still in progress.
// Only mounted for running rows, so no timer runs when nothing is in flight.
function LiveDuration({ startedAt }: { startedAt: string }) {
  const startMs = useMemo(() => new Date(startedAt).getTime(), [startedAt]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{formatRunDuration(Math.max(0, now - startMs))}</>;
}

function ResultsFooter({
  count,
  totalCount,
  hasMore,
  isLoadingMore,
}: {
  count: number;
  totalCount?: number;
  hasMore: boolean;
  isLoadingMore: boolean;
}) {
  return (
    <div className="text-muted-foreground flex h-10 items-center justify-center px-3 text-xs">
      {isLoadingMore ? (
        <span className="flex items-center gap-2">
          <Skeleton className="size-2 rounded-full" />
          Loading more runs
        </span>
      ) : hasMore ? (
        <span>
          Showing {count.toLocaleString()}
          {totalCount !== undefined ? ` of ${totalCount.toLocaleString()}` : ""}{" "}
          runs
        </span>
      ) : (
        <span>Showing all {count.toLocaleString()} matching runs</span>
      )}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b px-3 py-2">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-48 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No runs</EmptyTitle>
        <EmptyDescription>
          No workflow runs match the current filters.
        </EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" onClick={onClearFilters}>
        Clear filters
      </Button>
    </Empty>
  );
}
