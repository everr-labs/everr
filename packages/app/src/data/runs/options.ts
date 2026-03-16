import { queryOptions } from "@tanstack/react-query";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  getAllJobsSteps,
  getLatestRuns,
  getRunDetails,
  getRunJobs,
  getRunSpans,
  getStepLogs,
} from "./server";

// Query options factories
export const latestRunsOptions = ({ timeRange }: TimeRangeInput) =>
  queryOptions({
    queryKey: ["runs", "latest", timeRange],
    queryFn: () => getLatestRuns({ data: { timeRange } }),
  });

export const runDetailsOptions = (traceId: string) =>
  queryOptions({
    queryKey: ["runs", "details", traceId],
    queryFn: () => getRunDetails({ data: traceId }),
  });

export const runJobsOptions = (traceId: string) =>
  queryOptions({
    queryKey: ["runs", "jobs", traceId],
    queryFn: () => getRunJobs({ data: traceId }),
  });

export const allJobsStepsOptions = (input: {
  traceId: string;
  jobIds: string[];
}) =>
  queryOptions({
    queryKey: ["runs", "allJobsSteps", input.traceId, input.jobIds],
    queryFn: () => getAllJobsSteps({ data: input }),
  });

export const stepLogsOptions = (input: {
  traceId: string;
  jobName: string;
  stepNumber: string;
}) =>
  queryOptions({
    queryKey: [
      "runs",
      "stepLogs",
      input.traceId,
      input.jobName,
      input.stepNumber,
    ],
    queryFn: () => getStepLogs({ data: { ...input, fullLogs: true } }),
  });

export const runSpansOptions = (traceId: string) =>
  queryOptions({
    queryKey: ["runs", "spans", traceId],
    queryFn: () => getRunSpans({ data: traceId }),
  });
