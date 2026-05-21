import { z } from "zod";
import { TimeRangeSchema } from "@/lib/time-range";

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
