import { RetryError } from "@everr/ui/components/retry-error";
import { virtuosoScrollAreaComponents } from "@everr/ui/components/scroll-area";
import { Skeleton } from "@everr/ui/components/skeleton";
import { type ReactNode, useCallback, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import type { ErrorIssueSummary } from "../data/types";
import { showingAll } from "../../filters/ui/no-results";
import { ErrorIssueRow, type RenderErrorIssueLink } from "./error-issue-row";

const VIRTUOSO_OVERSCAN = 600;

export function ErrorIssueList({
  issues,
  isPending,
  isError,
  error,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  empty,
  renderIssueLink,
}: {
  issues: ErrorIssueSummary[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  onRetry: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** What shows when nothing matches. */
  empty: ReactNode;
  renderIssueLink: RenderErrorIssueLink;
}) {
  const endReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) onLoadMore();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  const itemContent = useCallback(
    (_index: number, issue: ErrorIssueSummary) => (
      <ErrorIssueRow issue={issue} renderIssueLink={renderIssueLink} />
    ),
    [renderIssueLink],
  );

  const components = useMemo(
    () => ({
      ...virtuosoScrollAreaComponents,
      // oxlint-disable-next-line react/no-unstable-nested-components -- Preserve the existing footer component lifetime when pagination values change.
      Footer: () => (
        <div className="text-muted-foreground flex h-10 items-center justify-center px-3 text-xs">
          {isFetchingNextPage ? (
            <span className="flex items-center gap-2">
              <Skeleton className="size-2 rounded-full" />
              Loading more errors
            </span>
          ) : hasNextPage ? (
            <span>Showing {issues.length.toLocaleString()} errors</span>
          ) : (
            <span>{showingAll(issues.length, "error")}</span>
          )}
        </div>
      ),
    }),
    [isFetchingNextPage, hasNextPage, issues.length],
  );

  if (isPending) return <ListSkeleton />;
  if (isError) {
    return (
      <RetryError
        title="Failed to load errors"
        message={error?.message ?? "Unknown error"}
        onRetry={onRetry}
      />
    );
  }
  if (issues.length === 0) return empty;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListHeader />
      <Virtuoso
        className="min-h-0 min-w-0 flex-1"
        data={issues}
        increaseViewportBy={VIRTUOSO_OVERSCAN}
        endReached={endReached}
        components={components}
        computeItemKey={(_, issue) => issue.fingerprint}
        itemContent={itemContent}
      />
    </div>
  );
}

function ListHeader() {
  return (
    <div className="text-muted-foreground bg-background flex items-center gap-2 border-b px-3 py-1.5 text-xs font-medium">
      <span className="min-w-0 flex-1">Error</span>
      <span className="hidden w-28 shrink-0 md:inline">Service</span>
      <span className="hidden w-24 shrink-0 lg:inline">Trend</span>
      <span className="w-24 shrink-0 text-right">Occurrences</span>
      <span className="hidden w-20 shrink-0 text-right lg:inline">Last seen</span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {Array.from({ length: 12 }).map((_, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- Fixed-length placeholder rows with no data identity; the list is static.
        <div key={index} className="flex items-center gap-2 border-b px-3 py-1.5">
          <Skeleton className="h-4 min-w-0 flex-1" />
          <Skeleton className="hidden h-3 w-28 md:block" />
          <Skeleton className="hidden h-3 w-24 lg:block" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="hidden h-3 w-16 lg:block" />
        </div>
      ))}
    </div>
  );
}
