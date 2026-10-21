import { Skeleton } from "@everr/ui/components/skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { DataPanel } from "#app/components/data-panel.tsx";
import { PanelShell } from "#app/components/panel-shell.tsx";
import { TraceWaterfall } from "#app/components/run-detail/trace-waterfall.tsx";
import { runDetailsOptions, runSpansOptions } from "#app/data/runs/options.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/runs/$traceId/trace",
)({
  loader: async ({ context: { queryClient }, params }) => {
    await Promise.all([
      queryClient.ensureQueryData(runSpansOptions(params.traceId)),
      queryClient.ensureQueryData(runDetailsOptions(params.traceId)),
    ]);
  },
  component: TraceView,
  pendingComponent: TraceViewSkeleton,
});

const traceSkeleton = (
  <div className="space-y-2 p-4">
    {Array.from({ length: 6 }).map((_, i) => (
      // oxlint-disable-next-line react/no-array-index-key -- fixed-length static skeleton placeholders with no data identity
      <div key={i} className="flex items-center gap-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-6 flex-1" />
      </div>
    ))}
  </div>
);

function TraceView() {
  const { traceId } = Route.useParams();

  return (
    <DataPanel
      queries={[runSpansOptions(traceId)]}
      className="flex h-full flex-col overflow-hidden"
      inset="flush-content"
      skeleton={traceSkeleton}
    >
      {(spans) =>
        spans.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No trace data available</p>
        ) : (
          <TraceWaterfall spans={spans} traceId={traceId} />
        )
      }
    </DataPanel>
  );
}

function TraceViewSkeleton() {
  return (
    <PanelShell
      status="pending"
      className="flex h-full flex-col overflow-hidden"
      skeleton={traceSkeleton}
    />
  );
}
