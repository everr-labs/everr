import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";
import { getTraceOptions } from "@/data/traces/options";
import type { Span } from "@/data/traces/types";
import { computeDetailWindow } from "@/data/traces/window";
import { useDelayedFlag } from "@/hooks/use-delayed-flag";
import { serviceColor } from "./shared/service-color";
import { TimelineView } from "./timeline/timeline-view";

const SKELETON_DELAY_MS = 1000;

const route = getRouteApi("/_authenticated/_dashboard/traces/$traceId");

export function TraceDetailPage() {
  const { traceId } = route.useParams();
  const search = route.useSearch();
  const { span: focusedSpan } = search;
  const navigate = route.useNavigate();

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
      traceId,
      window: detailWindow,
      refresh: search.refresh ?? "",
    }),
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
      <TraceHeader spans={spans} traceId={traceId} />
      <TimelineView
        key={traceId}
        spans={spans}
        focusedSpan={focusedSpan}
        onSelectSpan={(spanId) =>
          navigate({
            search: (prev) => ({ ...prev, span: spanId }),
            replace: true,
          })
        }
      />
    </div>
  );
}

function pickRootSpan(spans: Span[]): Span {
  const ids = new Set(spans.map((s) => s.spanId));
  const roots = spans.filter(
    (s) => s.parentSpanId === "" || !ids.has(s.parentSpanId),
  );
  const pool = roots.length > 0 ? roots : spans;
  const sorted = [...pool].sort((a, b) => {
    const at = BigInt(a.timestampNs);
    const bt = BigInt(b.timestampNs);
    if (at !== bt) return at < bt ? -1 : 1;
    return a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0;
  });
  const root = sorted[0];
  if (!root) throw new Error("pickRootSpan called with no spans");
  return root;
}

function TraceHeader({ spans, traceId }: { spans: Span[]; traceId: string }) {
  const root = useMemo(() => pickRootSpan(spans), [spans]);
  return (
    <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
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
