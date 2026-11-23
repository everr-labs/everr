import { appQueryOptions } from "@everr/ui/lib/query-options";
import { searchRuns } from "./server";

export const searchRunsOptions = (searchQuery: string) =>
  appQueryOptions({
    queryKey: ["runs", "search", searchQuery],
    queryFn: () => searchRuns({ data: { query: searchQuery } }),
  });
