import { Skeleton } from "@everr/ui/components/skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { DataPanel } from "@/components/data-panel";
import { PanelShell } from "@/components/panel-shell";
import { TraceWaterfall } from "@/components/run-detail";
import { runSpansOptions } from "@/data/runs/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runs/$traceId/trace",
)({
  loader: async ({ context: { queryClient }, params }) => {
    await queryClient.ensureQueryData(runSpansOptions(params.traceId));
  },
  component: TraceView,
  pendingComponent: TraceViewSkeleton,
});

const traceSkeleton = (
  <div className="space-y-2 p-4">
    {Array.from({ length: 6 }).map((_, i) => (
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
          <p className="text-muted-foreground text-center py-8">
            No trace data available
          </p>
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
