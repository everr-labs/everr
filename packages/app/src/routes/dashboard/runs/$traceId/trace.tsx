import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { TraceWaterfall } from "@/components/run-detail";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { flakyTestNamesOptions } from "@/data/flaky-tests";
import { runDetailsOptions, runSpansOptions } from "@/data/runs";

export const Route = createFileRoute("/dashboard/runs/$traceId/trace")({
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

function TraceView() {
  const { traceId } = Route.useParams();
  const { data: spans } = useQuery(runSpansOptions(traceId));
  const { data: runDetails } = useQuery(runDetailsOptions(traceId));
  const { data: flakyTestNames } = useQuery(
    flakyTestNamesOptions(runDetails?.repo ?? ""),
  );

  if (!spans) return null;

  if (spans.length === 0) {
    return (
      <Card size="sm" className="h-full">
        <CardContent className="flex h-full items-center justify-center">
          <p className="text-muted-foreground">No trace data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm" className="flex h-full flex-col overflow-hidden">
      <CardContent className="-my-3 min-h-0 flex-1 overflow-hidden p-0!">
        <TraceWaterfall
          spans={spans}
          traceId={traceId}
          flakyTestNames={flakyTestNames}
        />
      </CardContent>
    </Card>
  );
}

function TraceViewSkeleton() {
  return (
    <Card size="sm">
      <CardContent className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 flex-1" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
