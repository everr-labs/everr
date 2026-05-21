import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useCallback, useMemo } from "react";
import { getTraceOptions } from "../data/options";
import type { TracesRepositoryLike } from "../data/repository";
import type { Span } from "../data/types";
import { computeDetailWindow } from "../data/window";
import { useDelayedFlag } from "../util/use-delayed-flag";
import { serviceColor } from "./shared/service-color";
import { TimelineView } from "./timeline/timeline-view";
import { pickRootSpan } from "./timeline/use-timeline-layout";

const SKELETON_DELAY_MS = 1000;

export type TraceDetailSearch = {
  span?: string;
  start?: string;
  end?: string;
  from?: string;
  to?: string;
  refresh?: string;
};

export type TraceDetailProps = {
  repo: TracesRepositoryLike;
  traceId: string;
  search: TraceDetailSearch;
  onBack?: () => void;
  onSpanChange: (spanId: string | undefined) => void;
};

export function TraceDetail({
  repo,
  traceId,
  search,
  onBack,
  onSpanChange,
}: TraceDetailProps) {
  const { span: focusedSpan } = search;

  const detailWindow = useMemo(
    () =>
      computeDetailWindow({
        start: search.start,
        end: search.end,
        timeRange: { from: search.from, to: search.to },
      }),
    [search.start, search.end, search.from, search.to],
  );

  const {
    data: spans,
    isPending,
    error,
    refetch,
  } = useQuery(
    getTraceOptions({
      repo,
      traceId,
      window: detailWindow,
      refresh: search.refresh ?? "",
    }),
  );

  const onSelectSpan = useCallback(
    (spanId: string | undefined) => {
      onSpanChange(spanId);
    },
    [onSpanChange],
  );

  const showSkeleton = useDelayedFlag(isPending, SKELETON_DELAY_MS);
  if (isPending) return showSkeleton ? <DetailSkeleton /> : null;
  if (error) {
    return (
      <ErrorState
        message={(error as Error).message}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }
  if (!spans || spans.length === 0) {
    return <NotFoundState traceId={traceId} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TraceHeader spans={spans} traceId={traceId} onBack={onBack} />
      <TimelineView
        key={traceId}
        spans={spans}
        focusedSpan={focusedSpan}
        onSelectSpan={onSelectSpan}
      />
    </div>
  );
}

function TraceHeader({
  spans,
  traceId,
  onBack,
}: {
  spans: Span[];
  traceId: string;
  onBack?: () => void;
}) {
  const root = useMemo(() => pickRootSpan(spans), [spans]);
  if (!root) return null;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
      {onBack && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to traces"
          title="Back to traces"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
      )}
      <span
        className="size-2.5 rounded-full"
        style={{
          backgroundColor: serviceColor(
            root.serviceNamespace,
            root.serviceName,
          ),
        }}
      />
      <div className="min-w-0 max-w-2xl flex-1">
        <div className="truncate font-medium">{root.spanName}</div>
        <div className="text-muted-foreground truncate text-xs">
          {root.serviceName} · {traceId}
        </div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-2.5 rounded-full" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="ml-auto h-7 w-20" />
      </div>
      <Skeleton className="h-7 w-40" />
      <div className="flex-1 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
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
        <EmptyTitle>Failed to load trace</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </Empty>
  );
}

function NotFoundState({ traceId }: { traceId: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Trace not found</EmptyTitle>
        <EmptyDescription>
          No spans matched trace id <code className="text-xs">{traceId}</code>{" "}
          within the queried window. The trace may have been deleted or fall
          outside the time range.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
