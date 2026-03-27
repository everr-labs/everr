import { buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@everr/ui/components/tabs";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  useMatch,
  useParams,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { JobTreeNav, RunHeader } from "@/components/run-detail";
import {
  allJobsStepsOptions,
  runDetailsOptions,
  runJobsOptions,
} from "@/data/runs/options";
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runs/$traceId",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { workflowName?: string } }) =>
      match.loaderData?.workflowName ?? "Run Details",
    hideTimeRangePicker: true,
  },
  head: () => ({
    meta: [{ title: "Everr - Run Details" }],
  }),
  loader: async ({ context: { queryClient }, params }) => {
    const [runDetails, jobs] = await Promise.all([
      queryClient.ensureQueryData(runDetailsOptions(params.traceId)),
      queryClient.ensureQueryData(runJobsOptions(params.traceId)),
    ]);

    await queryClient.prefetchQuery(
      allJobsStepsOptions({
        traceId: params.traceId,
        jobIds: jobs.map((j) => j.jobId),
      }),
    );

    return { traceId: params.traceId, workflowName: runDetails?.workflowName };
  },
  component: RunDetailLayout,
  pendingComponent: RunDetailSkeleton,
  errorComponent: RunDetailError,
});

function RunDetailLayout() {
  const { traceId } = Route.useParams();
  useRealtimeSubscription({ scope: "trace", traceId });
  const { data: runDetails } = useQuery(runDetailsOptions(traceId));
  const { data: jobs } = useQuery(runJobsOptions(traceId));
  const { data: stepsByJobId } = useQuery(
    allJobsStepsOptions({
      traceId,
      jobIds: (jobs ?? []).map((j) => j.jobId),
    }),
  );
  // useParams with strict: false returns ALL matched params including child route params
  const params = useParams({ strict: false });
  const jobDetailMatch = useMatch({
    from: "/_authenticated/_dashboard/runs/$traceId/jobs/$jobId/",
    shouldThrow: false,
  });
  const stepDetailMatch = useMatch({
    from: "/_authenticated/_dashboard/runs/$traceId/jobs/$jobId/steps/$stepNumber",
    shouldThrow: false,
  });
  const traceMatch = useMatch({
    from: "/_authenticated/_dashboard/runs/$traceId/trace",
    shouldThrow: false,
  });

  if (!runDetails) {
    return (
      <div className="space-y-3">
        <Card size="sm">
          <CardContent className="pt-4">
            <p className="text-muted-foreground text-center">Run not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <RunHeader
        runId={runDetails.runId}
        runAttempt={runDetails.runAttempt}
        workflowName={runDetails.workflowName}
        conclusion={runDetails.conclusion}
        repo={runDetails.repo}
        branch={runDetails.branch}
        timestamp={runDetails.timestamp}
        htmlUrl={runDetails.htmlUrl}
        pullRequestUrls={runDetails.pullRequestUrls}
      />

      <Tabs
        value={traceMatch ? "Trace" : "Jobs"}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="shrink-0">
          <TabsTrigger value="Jobs">
            {stepDetailMatch ? (
              <Link
                to="/runs/$traceId/jobs/$jobId/steps/$stepNumber"
                params={{
                  traceId,
                  jobId: stepDetailMatch.params.jobId,
                  stepNumber: stepDetailMatch.params.stepNumber,
                }}
              >
                Jobs
              </Link>
            ) : jobDetailMatch ? (
              <Link
                to="/runs/$traceId/jobs/$jobId"
                params={{ traceId, jobId: jobDetailMatch.params.jobId }}
              >
                Jobs
              </Link>
            ) : (
              <Link to="/runs/$traceId" params={{ traceId }}>
                Jobs
              </Link>
            )}
          </TabsTrigger>
          <TabsTrigger value="Trace">
            <Link to="/runs/$traceId/trace" params={{ traceId }}>
              Trace
            </Link>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="Jobs" className="min-h-0 flex-1">
          <div className="grid h-full gap-3 lg:grid-cols-[280px_1fr]">
            {/* Jobs Tree Panel */}
            <Card size="sm" className="flex flex-col overflow-hidden">
              <CardHeader className="shrink-0">
                <CardTitle>Jobs</CardTitle>
                <CardDescription>
                  {(jobs ?? []).length} jobs in this run
                </CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-auto">
                <JobTreeNav
                  jobs={jobs ?? []}
                  stepsByJobId={stepsByJobId ?? {}}
                  traceId={traceId}
                  selectedJobId={(params as { jobId?: string }).jobId}
                />
              </CardContent>
            </Card>

            {/* Right pane content from child routes */}
            <Outlet />
          </div>
        </TabsContent>
        <TabsContent value="Trace" className="min-h-0 flex-1">
          <Outlet />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RunDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-7 w-7" />
        <Skeleton className="size-5" />
        <Skeleton className="h-6 w-48" />
      </div>
      <Skeleton className="ml-14 h-3 w-40" />
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_1fr]">
        <Card size="sm" className="flex flex-col overflow-hidden">
          <CardHeader className="shrink-0">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-32" />
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2 overflow-auto">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card size="sm" className="h-full">
          <CardContent className="flex h-full items-center justify-center">
            <Skeleton className="h-4 w-48" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RunDetailError({ error }: { error: Error }) {
  return (
    <div className="space-y-3">
      <Link
        to="/"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "h-7 px-2",
        )}
      >
        <ArrowLeft className="size-4" />
      </Link>
      <Card size="sm">
        <CardContent className="pt-4">
          <div className="text-center">
            <p className="text-destructive font-medium">
              Failed to load run details
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {error.message}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
