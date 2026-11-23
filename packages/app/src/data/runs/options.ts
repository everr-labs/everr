import { dataQueryOptions } from "@everr/ui/lib/query-options";
import { getAllJobsSteps, getRunDetails, getRunJobs, getRunSpans } from "./server";

// Query options factories
export const runDetailsOptions = (traceId: string) =>
  dataQueryOptions({
    queryKey: ["runs", "details", traceId],
    queryFn: () => getRunDetails({ data: traceId }),
  });

export const runJobsOptions = (traceId: string) =>
  dataQueryOptions({
    queryKey: ["runs", "jobs", traceId],
    queryFn: () => getRunJobs({ data: traceId }),
  });

export const allJobsStepsOptions = (input: { traceId: string; jobIds: string[] }) =>
  // oxlint-disable-next-line query/exhaustive-deps -- DI repo / input already in key; not a real missing dep
  dataQueryOptions({
    queryKey: ["runs", "allJobsSteps", input.traceId, input.jobIds],
    queryFn: () => getAllJobsSteps({ data: input }),
  });

export const runSpansOptions = (traceId: string) =>
  dataQueryOptions({
    queryKey: ["runs", "spans", traceId],
    queryFn: () => getRunSpans({ data: traceId }),
  });
