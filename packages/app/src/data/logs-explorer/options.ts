import { queryOptions } from "@tanstack/react-query";
import type { TimeRange } from "@/lib/time-range";
import type {
  LogFilterOptions,
  LogsExplorerInput,
  LogsExplorerResult,
} from "./schemas";
import { getLogFilterOptions, getLogsExplorer } from "./server";

type LogsExplorerInfiniteInput = Omit<
  LogsExplorerInput,
  "includeSummary" | "offset"
>;

export const logsExplorerOptions = (input: LogsExplorerInput) =>
  queryOptions({
    queryKey: ["logs", "explorer", input],
    queryFn: () => getLogsExplorer({ data: input }),
  });

export const logsExplorerInfiniteOptions = (
  input: LogsExplorerInfiniteInput,
) => ({
  queryKey: ["logs", "explorer", "infinite", input] as const,
  queryFn: ({ pageParam }: { pageParam: number }) =>
    getLogsExplorer({
      data: {
        ...input,
        offset: pageParam,
        includeSummary: pageParam === 0,
      },
    }),
  initialPageParam: 0,
  getNextPageParam: (
    _lastPage: LogsExplorerResult,
    allPages: LogsExplorerResult[],
  ) => {
    const totalCount = allPages[0]?.totalCount ?? 0;
    const loadedCount = allPages.reduce(
      (count, page) => count + page.logs.length,
      0,
    );
    if (loadedCount >= totalCount) return undefined;
    return loadedCount;
  },
});

const logFilterOptionsBase = (input: { timeRange: TimeRange }) => ({
  queryKey: ["logs", "filterOptions", input.timeRange] as const,
  queryFn: () => getLogFilterOptions({ data: input }),
});

const createLogFieldFilter =
  (field: keyof LogFilterOptions) => (input: { timeRange: TimeRange }) => ({
    ...logFilterOptionsBase(input),
    select: (data: LogFilterOptions) => data[field],
  });

export const logServiceFilterOptions = createLogFieldFilter("services");
export const logRepoFilterOptions = createLogFieldFilter("repos");
