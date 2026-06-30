import { queryOptions } from "@tanstack/react-query";
import { searchRuns } from "./server";

export const searchRunsOptions = (searchQuery: string) =>
  queryOptions({
    queryKey: ["runs", "search", searchQuery],
    queryFn: () => searchRuns({ data: { query: searchQuery } }),
  });
