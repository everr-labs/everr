import type { TimeRange } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type {
  FilterOptions,
  RunsHistogramInput,
  RunsListInput,
} from "./schemas";
import {
  getRunFilterOptions,
  getRunsHistogram,
  getRunsList,
  searchRuns,
} from "./server";

// Offset-based infinite scroll for the runs explorer: each page advances the
// offset by the number of rows already loaded and stops once a short page
// (fewer than `limit` rows) comes back.
export const runsListInfiniteOptions = (
  input: Omit<RunsListInput, "offset" | "includeTotalCount">,
) =>
  infiniteQueryOptions({
    queryKey: ["runs", "list", "infinite", input] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      // Only the first page needs the total (for the footer count).
      getRunsList({
        data: {
          ...input,
          offset: pageParam,
          includeTotalCount: pageParam === 0,
        },
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.runs.length < input.limit) return undefined;
      return allPages.reduce((count, page) => count + page.runs.length, 0);
    },
  });

export const runsHistogramOptions = (input: RunsHistogramInput) =>
  queryOptions({
    queryKey: ["runs", "histogram", input],
    queryFn: () => getRunsHistogram({ data: input }),
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
