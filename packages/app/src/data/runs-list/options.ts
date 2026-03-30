import { queryOptions } from "@tanstack/react-query";
import type { TimeRange } from "@/lib/time-range";
import type { FilterOptions, RunsListInput } from "./schemas";
import { getRunFilterOptions, getRunsList, searchRuns } from "./server";

// Query options factories
export const runsListOptions = (input: RunsListInput) =>
  queryOptions({
    queryKey: ["runs", "list", input],
    queryFn: () => getRunsList({ data: input }),
  });

const runFilterOptionsBase = (input: { timeRange: TimeRange }) => ({
  queryKey: ["runs", "filterOptions", input.timeRange] as const,
  queryFn: () => getRunFilterOptions({ data: input }),
});

const createRunFieldFilter =
  (field: keyof FilterOptions) => (input: { timeRange: TimeRange }) => ({
    ...runFilterOptionsBase(input),
    select: (data: FilterOptions) => data[field],
  });

export const runRepoFilterOptions = createRunFieldFilter("repos");
export const runBranchFilterOptions = createRunFieldFilter("branches");
export const runWorkflowNameFilterOptions =
  createRunFieldFilter("workflowNames");

export const searchRunsOptions = (searchQuery: string) =>
  queryOptions({
    queryKey: ["runs", "search", searchQuery],
    queryFn: () => searchRuns({ data: { query: searchQuery } }),
  });
