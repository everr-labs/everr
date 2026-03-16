import { queryOptions } from "@tanstack/react-query";
import type { FlakyTestsFilterInput, TestDetailInput } from "./schemas";
import {
  getFlakinessTrend,
  getFlakyTestFilterOptions,
  getFlakyTestNames,
  getFlakyTestSummary,
  getFlakyTests,
  getRunnerFlakiness,
  getTestDailyResults,
  getTestHistory,
} from "./server";

// Query options factories
export const flakyTestsOptions = (input: FlakyTestsFilterInput) =>
  queryOptions({
    queryKey: ["flakyTests", "list", input],
    queryFn: () => getFlakyTests({ data: input }),
  });

export const flakyTestSummaryOptions = (input: FlakyTestsFilterInput) =>
  queryOptions({
    queryKey: ["flakyTests", "summary", input],
    queryFn: () => getFlakyTestSummary({ data: input }),
  });

export const flakinessTrendOptions = (input: FlakyTestsFilterInput) =>
  queryOptions({
    queryKey: ["flakyTests", "trend", input],
    queryFn: () => getFlakinessTrend({ data: input }),
  });

export const flakyTestFilterOptionsOptions = () =>
  queryOptions({
    queryKey: ["flakyTests", "filterOptions"],
    queryFn: () => getFlakyTestFilterOptions(),
  });

export const testHistoryOptions = (input: TestDetailInput) =>
  queryOptions({
    queryKey: ["flakyTests", "history", input],
    queryFn: () => getTestHistory({ data: input }),
  });

export const runnerFlakinessOptions = (input: TestDetailInput) =>
  queryOptions({
    queryKey: ["flakyTests", "runnerFlakiness", input],
    queryFn: () => getRunnerFlakiness({ data: input }),
  });

export const testDailyResultsOptions = (input: TestDetailInput) =>
  queryOptions({
    queryKey: ["flakyTests", "dailyResults", input],
    queryFn: () => getTestDailyResults({ data: input }),
  });

export const flakyTestNamesOptions = (repo: string) =>
  queryOptions({
    queryKey: ["flakyTests", "names", repo],
    queryFn: () => getFlakyTestNames({ data: { repo } }),
  });
