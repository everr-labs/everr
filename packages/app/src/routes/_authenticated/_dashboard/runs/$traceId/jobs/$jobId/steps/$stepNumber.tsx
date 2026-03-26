import { Card, CardContent } from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { LogViewer } from "@/components/run-detail";
import { ResourceUsagePanel } from "@/components/run-detail/resource-usage-panel";
import { jobResourceUsageOptions } from "@/data/resource-usage";
import {
  allJobsStepsOptions,
  runDetailsOptions,
  runJobsOptions,
} from "@/data/runs/options";
import { getStepLogs } from "@/data/runs/server";

const LOG_PAGE_SIZE = 1000;

type PageParam = { tail: number; offset: number; limit: number };
type StepLogsPage = { logs: unknown[]; totalCount: number; offset: number };

function getAnchorLine(): number | null {
  if (typeof window === "undefined") return null;
  const match = window.location.hash.match(/^#L(\d+)$/);
  return match ? Number(match[1]) : null;
}

function getInitialPageParam(): PageParam {
  const anchor = getAnchorLine();
  if (anchor !== null) {
    const offset = Math.max(0, anchor - 1 - Math.floor(LOG_PAGE_SIZE / 2));
    return { tail: 0, offset, limit: LOG_PAGE_SIZE };
  }
  return { tail: LOG_PAGE_SIZE, offset: 0, limit: 0 };
}

function stepLogsQueryKey(
  traceId: string,
  jobName: string,
  stepNumber: string,
) {
  return ["runs", "stepLogs", traceId, jobName, stepNumber] as const;
}

function stepLogsInfiniteOptions(
  traceId: string,
  jobName: string,
  stepNumber: string,
) {
  return {
    queryKey: stepLogsQueryKey(traceId, jobName, stepNumber),
    queryFn: ({ pageParam }: { pageParam: PageParam }) => {
      if (pageParam.tail) {
        return getStepLogs({
          data: { traceId, jobName, stepNumber, tail: pageParam.tail },
        });
      }
      return getStepLogs({
        data: {
          traceId,
          jobName,
          stepNumber,
          offset: pageParam.offset,
          limit: pageParam.limit,
        },
      });
    },
    initialPageParam: getInitialPageParam(),
    getPreviousPageParam: (
      _firstPage: StepLogsPage,
      allPages: StepLogsPage[],
    ) => {
      if (!allPages?.length) return undefined;
      const firstOffset = allPages[0].offset;
      if (firstOffset <= 0) return undefined;
      const limit = Math.min(LOG_PAGE_SIZE, firstOffset);
      return { tail: 0, offset: firstOffset - limit, limit };
    },
    getNextPageParam: (_lastPage: StepLogsPage, allPages: StepLogsPage[]) => {
      if (!allPages?.length) return undefined;
      const lastPage = allPages[allPages.length - 1];
      const endOffset = lastPage.offset + lastPage.logs.length;
      if (endOffset >= lastPage.totalCount) return undefined;
      const limit = Math.min(LOG_PAGE_SIZE, lastPage.totalCount - endOffset);
      return { tail: 0, offset: endOffset, limit };
    },
  };
}

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runs/$traceId/jobs/$jobId/steps/$stepNumber",
)({
  component: StepDetailPage,
  loader: async ({ context: { queryClient }, params }) => {
    const jobs = await queryClient.ensureQueryData(
      runJobsOptions(params.traceId),
    );
    const selectedJob = jobs.find((j) => j.jobId === params.jobId);
    const jobName = selectedJob?.name ?? "";

    if (jobName) {
      queryClient.prefetchInfiniteQuery(
        stepLogsInfiniteOptions(params.traceId, jobName, params.stepNumber),
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

  const [anchorLine] = useState(getAnchorLine);

  const {
    data: logsData,
    fetchPreviousPage,
    fetchNextPage,
    hasPreviousPage,
    hasNextPage,
    isFetchingPreviousPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    ...stepLogsInfiniteOptions(traceId, jobName, stepNumber),
    enabled: jobName !== "",
  });

  const allLogs = useMemo(
    () => logsData?.pages.flatMap((p) => p.logs) ?? [],
    [logsData?.pages],
  );

  const lineOffset = logsData?.pages[0]?.offset ?? 0;

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
          <LogViewer
            key={stepNumber} // Need to reset the internal state when navigating to a new step
            logs={allLogs}
            stepName={stepName}
            onLoadPrevious={hasPreviousPage ? fetchPreviousPage : undefined}
            onLoadNext={hasNextPage ? fetchNextPage : undefined}
            isLoadingPrevious={isFetchingPreviousPage}
            isLoadingNext={isFetchingNextPage}
            lineOffset={lineOffset}
            initialScrollToBottom={anchorLine === null}
          />
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
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
