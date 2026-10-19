import {
  getTraceOptions,
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
      refresh: deps.refresh ?? "off",
    }),
  );
}

export function TraceDetailRouteError({
  error,
  search,
}: {
  error: unknown;
  search: TraceDetailParams;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Failed to load trace</EmptyTitle>
        <EmptyDescription>
          {error instanceof Error ? error.message : String(error)}
        </EmptyDescription>
      </EmptyHeader>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link to="/traces" search={toTraceListSearch(search)} />}
      >
        Back to traces
      </Button>
    </Empty>
  );
}
