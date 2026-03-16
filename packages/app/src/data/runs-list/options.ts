import { queryOptions } from "@tanstack/react-query";
import type { RunsListInput } from "./schemas";
import { getRunFilterOptions, getRunsList, searchRuns } from "./server";

// Query options factories
export const runsListOptions = (input: RunsListInput) =>
  queryOptions({
    queryKey: ["runs", "list", input],
    queryFn: () => getRunsList({ data: input }),
  });

export const runFilterOptionsOptions = () =>
  queryOptions({
    queryKey: ["runs", "filterOptions"],
    queryFn: () => getRunFilterOptions(),
  });

export const searchRunsOptions = (searchQuery: string) =>
  queryOptions({
    queryKey: ["runs", "search", searchQuery],
    queryFn: () => searchRuns({ data: { query: searchQuery } }),
  });
