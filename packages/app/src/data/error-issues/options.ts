import { queryOptions } from "@tanstack/react-query";
import { getErrorIssueEnvironments, getErrorIssuesState, getTrackedErrorIssues } from "./server";

export const errorIssuesQueryKey = ["error-issues"] as const;

export const errorIssuesOptions = () =>
  queryOptions({
    queryKey: errorIssuesQueryKey,
    queryFn: () => getErrorIssuesState(),
  });

export const errorIssueEnvironmentsOptions = () =>
  queryOptions({
    queryKey: [...errorIssuesQueryKey, "environments"],
    queryFn: () => getErrorIssueEnvironments(),
  });

export const trackedErrorIssuesOptions = () =>
  queryOptions({
    queryKey: [...errorIssuesQueryKey, "tracked"],
    queryFn: () => getTrackedErrorIssues(),
    staleTime: 60_000,
  });
