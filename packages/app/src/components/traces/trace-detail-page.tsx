import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { getTraceOptions } from "@/data/traces/options";
import type { Span } from "@/data/traces/types";
import { computeDetailWindow } from "@/data/traces/window";
import { JsonView } from "./json/json-view";
import { formatDurationNs } from "./shared/format-duration";
import { serviceColor } from "./shared/service-color";
import { TimelineView } from "./timeline/timeline-view";

const route = getRouteApi("/_authenticated/_dashboard/traces/$traceId");

type Tab = "timeline" | "json";

export function TraceDetailPage() {
  const { traceId } = route.useParams();
  const search = route.useSearch();
  const { tab, span: focusedSpan } = search;
  const navigate = route.useNavigate();

  const window = useMemo(
    () =>
      computeDetailWindow({
        start: search.start,
        end: search.end,
        timeRange: { from: search.from ?? "", to: search.to ?? "" },
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
      window,
      refresh: search.refresh ?? "",
    }),
  );

  if (isPending) return <DetailSkeleton />;
  if (error) {
    return (
      <ErrorCard
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
      <TraceHeader
        spans={spans}
        traceId={traceId}
        onRefresh={() => {
          void refetch();
        }}
      />
      <TabsBar
        active={tab}
        onSelect={(next) =>
          navigate({
            search: (prev) => ({ ...prev, tab: next }),
            replace: true,
          })
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === "timeline" ? (
          <TimelineView
            spans={spans}
            focusedSpan={focusedSpan}
            onSelectSpan={(spanId) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  span: spanId === "" ? undefined : spanId,
                }),
                replace: true,
              })
            }
          />
        ) : (
          <JsonView spans={spans} />
        )}
      </div>
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

function computeTotalDurationNs(spans: Span[]): bigint {
  let start: bigint | undefined;
  let end = 0n;
  for (const s of spans) {
    const t = BigInt(s.timestampNs);
    const e = t + BigInt(s.duration);
    if (start === undefined || t < start) start = t;
    if (e > end) end = e;
  }
  return start === undefined ? 0n : end - start;
}

function TraceHeader({
  spans,
  traceId,
  onRefresh,
}: {
  spans: Span[];
  traceId: string;
  onRefresh: () => void;
}) {
  const root = pickRootSpan(spans);
  const total = computeTotalDurationNs(spans);
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
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{root.spanName}</div>
        <div className="text-muted-foreground truncate text-xs">
          {root.serviceName} · {traceId}
        </div>
      </div>
      <div className="text-muted-foreground text-xs tabular-nums">
        {formatDurationNs(total)}
      </div>
      <div className="text-muted-foreground text-xs">{spans.length} spans</div>
      <Button variant="outline" size="sm" onClick={onRefresh}>
        <RefreshCw className="size-3.5" />
        Refresh
      </Button>
    </div>
  );
}

function TabsBar({
  active,
  onSelect,
}: {
  active: Tab;
  onSelect: (next: Tab) => void;
}) {
  const tabs: { value: Tab; label: string }[] = [
    { value: "timeline", label: "Timeline" },
    { value: "json", label: "JSON" },
  ];
  return (
    <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
      {tabs.map((t) => {
        const isActive = t.value === active;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onSelect(t.value)}
            className={
              isActive
                ? "rounded-md bg-input/30 border border-input px-2 py-0.5 text-xs font-medium"
                : "text-muted-foreground hover:text-foreground rounded-md border border-transparent px-2 py-0.5 text-xs font-medium"
            }
          >
            {t.label}
          </button>
        );
      })}
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

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-destructive">
            Failed to load trace
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function NotFoundState({ traceId }: { traceId: string }) {
  return (
    <div className="p-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Trace not found</CardTitle>
          <CardDescription>
            No spans matched trace id <code className="text-xs">{traceId}</code>{" "}
            within the queried window. The trace may have been deleted or fall
            outside the time range.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
