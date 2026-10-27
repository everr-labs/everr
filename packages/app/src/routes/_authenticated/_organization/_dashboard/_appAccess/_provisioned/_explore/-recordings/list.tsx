import { recordingsInfiniteOptions } from "#app/data/recordings/options.ts";
import type {
  RecordingClipSummary,
  RecordingsRepositoryLike,
} from "#app/data/recordings/schemas.ts";
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { virtuosoScrollAreaComponents } from "@everr/ui/components/scroll-area";
import { Skeleton } from "@everr/ui/components/skeleton";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { recordingTitle, triggerLabel } from "./format";

export type RenderRecordingLink = (input: { clipId: string; children: ReactNode }) => ReactNode;

export function RecordingList({
  repo,
  timeRange,
  refresh,
  service,
  environment,
  renderClipLink,
}: {
  repo: RecordingsRepositoryLike;
  timeRange: TimeRange;
  refresh: string;
  service: string[];
  environment: string[];
  renderClipLink: RenderRecordingLink;
}) {
  const clipsQuery = useInfiniteQuery({
    ...recordingsInfiniteOptions(repo, { timeRange, refresh, service, environment }),
    placeholderData: keepPreviousData,
  });
  const clips = useMemo(() => (clipsQuery.data?.pages ?? []).flat(), [clipsQuery.data]);

  return (
    <RecordingClipList
      clips={clips}
      isPending={clipsQuery.isPending}
      isError={clipsQuery.isError}
      onRetry={() => void clipsQuery.refetch()}
      hasNextPage={clipsQuery.hasNextPage}
      isFetchingNextPage={clipsQuery.isFetchingNextPage}
      onLoadMore={() => void clipsQuery.fetchNextPage()}
      renderClipLink={renderClipLink}
    />
  );
}

function RecordingClipList({
  clips,
  isPending,
  isError,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  renderClipLink,
}: {
  clips: RecordingClipSummary[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  renderClipLink: RenderRecordingLink;
}) {
  const endReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) onLoadMore();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  const components = useMemo(
    () => ({
      ...virtuosoScrollAreaComponents,
      // oxlint-disable-next-line react/no-unstable-nested-components -- The footer closes over the current page size.
      Footer: () => (
        <div className="text-muted-foreground flex h-12 items-center justify-center px-3 text-xs">
          {isFetchingNextPage ? (
            <span className="flex items-center gap-2">
              <Skeleton className="size-2 rounded-full" />
              Loading more recordings
            </span>
          ) : hasNextPage ? (
            <span>Showing {clips.length.toLocaleString()} recordings</span>
          ) : (
            <span>Showing all {clips.length.toLocaleString()} matching recordings</span>
          )}
        </div>
      ),
    }),
    [isFetchingNextPage, hasNextPage, clips.length],
  );

  if (isPending) {
    return (
      <div className="flex flex-col">
        {Array.from({ length: 8 }).map((_, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- Placeholder rows have no identity.
          <div key={index} className="border-b px-3 py-2.5">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="mt-2 h-3 w-96 max-w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Empty className="min-h-60 border-0">
        <EmptyHeader>
          <EmptyTitle>Failed to load recordings</EmptyTitle>
          <EmptyDescription>Refresh the list and try again.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" variant="outline" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (clips.length === 0) {
    return (
      <Empty className="min-h-60 border-0">
        <EmptyHeader>
          <EmptyTitle>No recordings</EmptyTitle>
          <EmptyDescription>No Clips match the selected time range.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Virtuoso
      className="min-h-0 min-w-0 flex-1"
      data={clips}
      endReached={endReached}
      components={components}
      computeItemKey={(_, clip) => clip.clipId}
      itemContent={(_, clip) => <RecordingRow clip={clip} renderClipLink={renderClipLink} />}
    />
  );
}

function RecordingRow({
  clip,
  renderClipLink,
}: {
  clip: RecordingClipSummary;
  renderClipLink: RenderRecordingLink;
}) {
  const title = recordingTitle(clip);
  const url = clip.route && clip.url && clip.url !== clip.route ? clip.url : "";
  const trigger = triggerLabel(clip.trigger);
  const when = formatRelativeTime(clip.endedAt);

  return (
    <div className="border-b last:border-b-0">
      {renderClipLink({
        clipId: clip.clipId,
        children: (
          <div className="min-w-0 px-3 py-2.5 hover:bg-muted/40">
            <div className="truncate text-sm font-medium">{title}</div>
            {url ? (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{url}</div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className="max-w-52 justify-start" title={clip.serviceName}>
                <span className="truncate">{clip.serviceName || "unknown service"}</span>
              </Badge>
              {trigger ? <Badge variant="secondary">{trigger}</Badge> : null}
              <span title={`${clip.startedAt} to ${clip.endedAt}`}>{when}</span>
              {clip.sessionId ? (
                <span className="max-w-40 truncate font-mono" title={clip.sessionId}>
                  {clip.sessionId}
                </span>
              ) : null}
            </div>
          </div>
        ),
      })}
    </div>
  );
}
