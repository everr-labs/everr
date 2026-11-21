import { Spinner } from "@everr/ui/components/spinner";
import { RetryError } from "@everr/ui/components/retry-error";
import {
  virtuosoInitialItemCount,
  virtuosoScrollAreaComponents,
} from "@everr/ui/components/scroll-area";
import { Skeleton, SkeletonLine } from "@everr/ui/components/skeleton";
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
              <Spinner className="size-3" />
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
        initialItemCount={virtuosoInitialItemCount(issues.length)}
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

/** Type and message lengths for the placeholder rows: ragged like real ones,
 *  fixed so every render draws the same shape. */
const SKELETON_TYPE_WIDTHS = ["7rem", "9rem", "6rem", "8rem", "5rem"];
const SKELETON_MESSAGE_WIDTHS = ["9rem", "6rem", "11rem", "7rem", "10rem", "8rem"];

/** About 1200px of rows, a tall screen's list, clipped to what its height
 *  shows. No more: every bar repaints its shimmer on each frame. */
const SKELETON_ROW_COUNT = 36;

// The list's real header over rows built from `ErrorIssueRow`'s own cells, at
// its fonts and with the trend's 20px box that sets a row's height, so neither
// the header nor the rows move when the issues land.
function ListSkeleton() {
  return (
    <div aria-hidden className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ListHeader />
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-2 border-b px-3 py-1.5 text-sm leading-tight"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SkeletonLine className="shrink-0">
              <Skeleton
                className="h-3 rounded-sm"
                style={{ width: SKELETON_TYPE_WIDTHS[index % SKELETON_TYPE_WIDTHS.length] }}
              />
            </SkeletonLine>
            <SkeletonLine className="min-w-0">
              <Skeleton
                className="h-3 max-w-full rounded-sm"
                style={{ width: SKELETON_MESSAGE_WIDTHS[index % SKELETON_MESSAGE_WIDTHS.length] }}
              />
            </SkeletonLine>
          </div>
          <div className="hidden w-28 shrink-0 items-center gap-1.5 text-xs md:flex">
            <Skeleton className="size-2 shrink-0 rounded-full" />
            <SkeletonLine>
              <Skeleton className="h-3 w-20 rounded-sm" />
            </SkeletonLine>
          </div>
          <div className="hidden h-5 w-24 shrink-0 items-center lg:flex">
            <Skeleton className="h-3 w-full rounded-sm" />
          </div>
          <SkeletonLine className="w-24 shrink-0 justify-end">
            <Skeleton className="h-3 w-8 rounded-sm" />
          </SkeletonLine>
          <SkeletonLine className="hidden w-20 shrink-0 justify-end text-xs lg:flex">
            <Skeleton className="h-3 w-14 rounded-sm" />
          </SkeletonLine>
        </div>
      ))}
    </div>
  );
}
