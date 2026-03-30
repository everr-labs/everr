import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DataPanel } from "@/components/data-panel";
import { PanelShell } from "@/components/panel-shell";
import { TraceWaterfall } from "@/components/run-detail";
import { flakyTestNamesOptions } from "@/data/flaky-tests/options";
import { runDetailsOptions, runSpansOptions } from "@/data/runs/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runs/$traceId/trace",
)({
  loader: async ({ context: { queryClient }, params }) => {
    const [, runDetails] = await Promise.all([
      queryClient.ensureQueryData(runSpansOptions(params.traceId)),
      queryClient.ensureQueryData(runDetailsOptions(params.traceId)),
    ]);

    // Pre-fetch flaky test names for badge display
    if (runDetails?.repo) {
      await queryClient.prefetchQuery(flakyTestNamesOptions(runDetails.repo));
    }
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
  const { data: runDetails } = useQuery(runDetailsOptions(traceId));

  return (
    <DataPanel
      title=""
      queries={[
        runSpansOptions(traceId),
        flakyTestNamesOptions(runDetails?.repo ?? ""),
      ]}
      className="flex h-full flex-col overflow-hidden"
      skeleton={traceSkeleton}
    >
      {(spans, flakyTestNames) =>
        spans.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No trace data available
          </p>
        ) : (
          <TraceWaterfall
            spans={spans}
            traceId={traceId}
            flakyTestNames={flakyTestNames}
          />
        )
      }
    </DataPanel>
  );
}

function TraceViewSkeleton() {
  return (
    <PanelShell
      title=""
      status="pending"
      className="flex h-full flex-col overflow-hidden"
      skeleton={traceSkeleton}
    />
  );
}
