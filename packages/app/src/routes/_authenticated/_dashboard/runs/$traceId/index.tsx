import { Card, CardContent } from "@everr/ui/components/card";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { allJobsStepsOptions, runJobsOptions } from "@/data/runs/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runs/$traceId/",
)({
  loader: async ({ context: { queryClient }, params }) => {
    const jobs = await queryClient.ensureQueryData(
      runJobsOptions(params.traceId),
    );
    if (!jobs.length) return;

    const stepsByJobId = await queryClient.ensureQueryData(
      allJobsStepsOptions({
        traceId: params.traceId,
        jobIds: jobs.map((j) => j.jobId),
      }),
    );

    const firstJob = jobs[0];
    const firstSteps = stepsByJobId[firstJob.jobId];
    if (!firstSteps?.length) return;

    throw redirect({
      to: "/runs/$traceId/jobs/$jobId/steps/$stepNumber",
      params: {
        traceId: params.traceId,
        jobId: firstJob.jobId,
        stepNumber: firstSteps[0].stepNumber,
      },
      replace: true,
    });
  },
  component: RunDetailPage,
});

function RunDetailPage() {
  return (
    <Card size="sm">
      <CardContent className="flex h-[calc(100vh-200px)] items-center justify-center">
        <p className="text-muted-foreground text-sm">
          Select a step to view logs
        </p>
      </CardContent>
    </Card>
  );
}
