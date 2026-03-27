import { Card, CardContent } from "@everr/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { allJobsStepsOptions, runJobsOptions } from "@/data/runs/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runs/$traceId/",
)({
  component: RunDetailPage,
});

function RunDetailPage() {
  const { traceId } = Route.useParams();
  const navigate = useNavigate();
  const { data: jobs } = useQuery(runJobsOptions(traceId));
  const { data: stepsByJobId } = useQuery(
    allJobsStepsOptions({
      traceId,
      jobIds: (jobs ?? []).map((j) => j.jobId),
    }),
  );

  useEffect(() => {
    if (!jobs?.length || !stepsByJobId) return;
    const firstJob = jobs[0];
    const firstSteps = stepsByJobId[firstJob.jobId];
    if (!firstSteps?.length) return;
    void navigate({
      to: "/runs/$traceId/jobs/$jobId/steps/$stepNumber",
      params: {
        traceId,
        jobId: firstJob.jobId,
        stepNumber: firstSteps[0].stepNumber,
      },
      replace: true,
    });
  }, [jobs, stepsByJobId, traceId, navigate]);

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
