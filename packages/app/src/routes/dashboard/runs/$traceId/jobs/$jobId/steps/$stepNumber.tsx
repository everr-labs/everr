import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { LogViewer } from "@/components/run-detail";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getRunJobs, getStepLogs } from "@/data/runs";

const parentRoute = getRouteApi("/dashboard/runs/$traceId");

export const Route = createFileRoute(
  "/dashboard/runs/$traceId/jobs/$jobId/steps/$stepNumber",
)({
  component: StepDetailPage,
  loader: async ({ params }) => {
    // Fetch jobs to get jobName (needed for log fetching)
    const jobs = await getRunJobs({ data: params.traceId });
    const selectedJob = jobs.find((j) => j.jobId === params.jobId);
    const jobName = selectedJob?.name ?? "";

    const logs = jobName
      ? await getStepLogs({
          data: {
            traceId: params.traceId,
            jobName,
            stepNumber: params.stepNumber,
          },
        })
      : [];

    return { logs, jobName, stepNumber: params.stepNumber };
  },
  pendingComponent: StepLogSkeleton,
});

function StepDetailPage() {
  const { logs, stepNumber } = Route.useLoaderData();
  const { runDetails, stepsByJobId } = parentRoute.useLoaderData();
  const { jobId } = Route.useParams();

  if (!runDetails) {
    return null;
  }

  // Derive stepName from parent's stepsByJobId data
  const steps = stepsByJobId[jobId] ?? [];
  const selectedStep = steps.find((s) => s.stepNumber === stepNumber);
  const stepName = selectedStep?.name ?? "";

  return (
    <Card size="sm" className="flex h-full flex-col overflow-hidden">
      {/* TODO: Make a card variant with 0 padding*/}
      <CardContent className="!px-0 -my-3 min-h-0 flex-1">
        <LogViewer logs={logs} stepName={stepName} />
      </CardContent>
    </Card>
  );
}

function StepLogSkeleton() {
  return (
    <Card size="sm" className="h-full">
      <CardContent className="h-full p-0">
        <div className="space-y-1 p-3">
          {Array.from({ length: 20 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
