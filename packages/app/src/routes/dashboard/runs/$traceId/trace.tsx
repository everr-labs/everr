import { createFileRoute } from "@tanstack/react-router";
import { TraceWaterfall } from "@/components/run-detail";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getFlakyTestNames } from "@/data/flaky-tests";
import { getRunDetails, getRunSpans } from "@/data/runs";

export const Route = createFileRoute("/dashboard/runs/$traceId/trace")({
  loader: async ({ params }) => {
    const [spans, runDetails] = await Promise.all([
      getRunSpans({ data: params.traceId }),
      getRunDetails({ data: params.traceId }),
    ]);

    // Fetch flaky test names for badge display
    const flakyTestNames = runDetails?.repo
      ? await getFlakyTestNames({ data: { repo: runDetails.repo } })
      : [];

    return { spans, traceId: params.traceId, flakyTestNames };
  },
  component: TraceView,
  pendingComponent: TraceViewSkeleton,
});

function TraceView() {
  const { spans, traceId, flakyTestNames } = Route.useLoaderData();

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
