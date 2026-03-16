import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LogViewer } from "@/components/run-detail";
import { ResourceUsagePanel } from "@/components/run-detail/resource-usage-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { jobResourceUsageOptions } from "@/data/resource-usage";
import {
  allJobsStepsOptions,
  runDetailsOptions,
  runJobsOptions,
  stepLogsOptions,
} from "@/data/runs/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runs/$traceId/jobs/$jobId/steps/$stepNumber",
)({
  component: StepDetailPage,
  loader: async ({ context: { queryClient }, params }) => {
    // Jobs are already cached by parent route — read from cache to get jobName
    const jobs = await queryClient.ensureQueryData(
      runJobsOptions(params.traceId),
    );
    const selectedJob = jobs.find((j) => j.jobId === params.jobId);
    const jobName = selectedJob?.name ?? "";

    if (jobName) {
      queryClient.prefetchQuery(
        stepLogsOptions({
          traceId: params.traceId,
          jobName,
          stepNumber: params.stepNumber,
        }),
      );
    }

    queryClient.prefetchQuery(
      jobResourceUsageOptions({
        traceId: params.traceId,
        jobId: params.jobId,
      }),
    );
  },
  pendingComponent: StepLogSkeleton,
});

function StepDetailPage() {
  const { traceId, jobId, stepNumber } = Route.useParams();
  const { data: runDetails } = useQuery(runDetailsOptions(traceId));
  const { data: jobs } = useQuery(runJobsOptions(traceId));
  const { data: stepsByJobId } = useQuery(
    allJobsStepsOptions({
      traceId,
      jobIds: (jobs ?? []).map((j) => j.jobId),
    }),
  );
  const { data: resourceUsage } = useQuery(
    jobResourceUsageOptions({ traceId, jobId }),
  );

  const selectedJob = (jobs ?? []).find((j) => j.jobId === jobId);
  const jobName = selectedJob?.name ?? "";
  const { data: logs } = useQuery(
    stepLogsOptions({ traceId, jobName, stepNumber }),
  );

  if (!runDetails) {
    return null;
  }

  const steps = stepsByJobId?.[jobId] ?? [];
  const selectedStep = steps.find((s) => s.stepNumber === stepNumber);
  const stepName = selectedStep?.name ?? "";

  const stepWindow =
    selectedStep?.startTime && selectedStep?.endTime
      ? { startTime: selectedStep.startTime, endTime: selectedStep.endTime }
      : null;

  return (
    <Card size="sm" className="flex h-full flex-col overflow-hidden">
      {/* TODO: Make a card variant with 0 padding*/}
      <CardContent className="!px-0 -my-3 min-h-0 flex-1 flex flex-col">
        {resourceUsage && (
          <ResourceUsagePanel data={resourceUsage} stepWindow={stepWindow} />
        )}
        <div className="min-h-0 flex-1">
          <LogViewer logs={logs ?? []} stepName={stepName} />
        </div>
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
