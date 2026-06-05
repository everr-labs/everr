import {
  computeDetailWindow,
  getTraceOptions,
  TraceDetail,
  type TraceDetailParams,
  toTraceListSearch,
} from "@everr/telemetry-explorer/traces";
import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import type { QueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { remoteTracesRepo } from "@/data/traces/remote-repo";

export function getTraceDetailLoaderDeps(search: TraceDetailParams) {
  return {
    start: search.start,
    end: search.end,
    from: search.from,
    to: search.to,
    refresh: search.refresh,
  };
}

export async function ensureTraceDetailData({
  queryClient,
  traceId,
  deps,
}: {
  queryClient: QueryClient;
  traceId: string;
  deps: ReturnType<typeof getTraceDetailLoaderDeps>;
}) {
  await queryClient.ensureQueryData(
    getTraceOptions({
      repo: remoteTracesRepo,
      traceId,
      window: computeDetailWindow({
        start: deps.start,
        end: deps.end,
        timeRange: { from: deps.from, to: deps.to },
      }),
      refresh: deps.refresh ?? "",
    }),
  );
}

export function TraceDetailRouteContent({
  traceId,
  search,
  onBack,
  onClose,
  onSpanChange,
}: {
  traceId: string;
  search: TraceDetailParams;
  onBack?: () => void;
  onClose?: () => void;
  onSpanChange: (spanId: string | undefined) => void;
}) {
  return (
    <TraceDetail
      repo={remoteTracesRepo}
      traceId={traceId}
      search={search}
      onBack={onBack}
      onClose={onClose}
      onSpanChange={onSpanChange}
    />
  );
}

export function TraceDetailRouteError({
  error,
  search,
}: {
  error: Error;
  search: TraceDetailParams;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Failed to load trace</EmptyTitle>
        <EmptyDescription>{error.message}</EmptyDescription>
      </EmptyHeader>
      <Button
        variant="outline"
        size="sm"
        render={<Link to="/traces" search={toTraceListSearch(search)} />}
      >
        Back to traces
      </Button>
    </Empty>
  );
}
