import { queryOptions } from "@tanstack/react-query";
import {
  getAllJobsSteps,
  getRunDetails,
  getRunJobs,
  getRunSpans,
} from "./server";

// Query options factories
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

export const runSpansOptions = (traceId: string) =>
  queryOptions({
    queryKey: ["runs", "spans", traceId],
    queryFn: () => getRunSpans({ data: traceId }),
  });
