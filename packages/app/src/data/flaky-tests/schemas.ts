import { z } from "zod";
import { TimeRangeSchema } from "@/lib/time-range";

// Filter input for flaky tests list
export const FlakyTestsFilterInputSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string().optional(),
  branch: z.string().optional(),
  search: z.string().optional(),
});
export type FlakyTestsFilterInput = z.infer<typeof FlakyTestsFilterInputSchema>;

// Filter options (repos + branches that have test data)
export interface FlakyTestFilterOptions {
  repos: string[];
  branches: string[];
}

// Flaky test list item
export interface FlakyTest {
  repo: string;
  testPackage: string;
  testFullName: string;
  totalExecutions: number;
  failCount: number;
  passCount: number;
  skipCount: number;
  distinctRuns: number;
  distinctShas: number;
  failureRate: number;
  lastSeen: string;
  avgDuration: number;
  firstSeen: string;
  recentFailureRate: number;
}

// Daily result for heatmap
export interface TestDailyResult {
  date: string;
  passCount: number;
  failCount: number;
  skipCount: number;
}

// Summary stats
export interface FlakyTestSummary {
  flakyTestCount: number;
  totalTestCount: number;
  flakyPercentage: number;
}

// Flakiness trend (per-day)
export interface FlakinessTrendPoint {
  date: string;
  flakyCount: number;
  totalCount: number;
  flakyPercentage: number;
}

// Test detail history
export interface TestExecution {
  traceId: string;
  runId: string;
  runAttempt: number;
  headSha: string;
  headBranch: string;
  testResult: string;
  testDuration: number;
  runnerName: string;
  workflowName: string;
  jobName: string;
  timestamp: string;
}

export const TestHistoryInputSchema = z
  .object({
    timeRange: TimeRangeSchema,
    repo: z.string(),
    testFullName: z.string().optional(),
    testModule: z.string().optional(),
    testName: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((value, ctx) => {
    const hasFullName = Boolean(value.testFullName);
    const hasTestModule = Boolean(value.testModule);
    const hasTestName = Boolean(value.testName);
    if (!hasFullName && !hasTestModule && !hasTestName) {
      ctx.addIssue({
        code: "custom",
        message: "Provide testFullName, testModule, or testName.",
      });
    }
  });

export const TestDetailInputSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string(),
  testFullName: z.string(),
});
export type TestDetailInput = z.infer<typeof TestDetailInputSchema>;

// Runner breakdown for a specific test
export interface RunnerFlakiness {
  runnerName: string;
  totalExecutions: number;
  failCount: number;
  passCount: number;
  failureRate: number;
  avgDuration: number;
}
