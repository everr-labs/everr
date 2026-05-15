import { queryOptions } from "@tanstack/react-query";
import { getFlakyTestNames } from "./server";

// Query options factories
export const flakyTestNamesOptions = (repo: string) =>
  queryOptions({
    queryKey: ["flakyTests", "names", repo],
    queryFn: () => getFlakyTestNames({ data: { repo } }),
  });
