import { queryOptions } from "@tanstack/react-query";
import type { TimeRange } from "@/lib/time-range";
import type {
  LogFilterOptions,
  LogHistogramInput,
  LogIdentity,
  LogsExplorerInput,
  LogsTotalsInput,
} from "./schemas";
import {
  getLogDetail,
  getLogFilterOptions,
  getLogsExplorer,
  getLogsHistogram,
  getLogsTotals,
} from "./server";

type LogsExplorerInfiniteInput = Omit<LogsExplorerInput, "offset">;

export const logsExplorerInfiniteOptions = (
  input: LogsExplorerInfiniteInput,
) => ({
  queryKey: ["logs", "explorer", "infinite", input] as const,
  queryFn: ({ pageParam }: { pageParam: number }) =>
    getLogsExplorer({ data: { ...input, offset: pageParam } }),
  initialPageParam: 0,
  getNextPageParam: (
    lastPage: { logs: unknown[] },
    allPages: { logs: unknown[] }[],
  ) => {
    if (lastPage.logs.length < input.limit) return undefined;
    return allPages.reduce((count, page) => count + page.logs.length, 0);
  },
});

export const logsTotalsOptions = (input: LogsTotalsInput) =>
  queryOptions({
    queryKey: ["logs", "totals", input],
    queryFn: () => getLogsTotals({ data: input }),
  });

export const logDetailOptions = (identity: LogIdentity) =>
  queryOptions({
    queryKey: ["logs", "detail", identity],
    queryFn: () => getLogDetail({ data: identity }),
  });

export const logsHistogramOptions = (input: LogHistogramInput) =>
  queryOptions({
    queryKey: ["logs", "histogram", input],
    queryFn: () => getLogsHistogram({ data: input }),
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
