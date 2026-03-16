import { z } from "zod";
import { TimeRangeSchema } from "@/lib/time-range";

export interface RunListItem {
  traceId: string;
  runId: string;
  runAttempt: number;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  duration: number;
  timestamp: string;
  sender: string;
  headSha?: string;
  jobCount: number;
  failingSteps?: FailingStepSummary[];
}

export interface RunsListResult {
  runs: RunListItem[];
  totalCount: number;
}

export interface FailingStepSummary {
  jobName: string;
  jobId: string;
  stepNumber: number;
  stepName: string;
}

export const RunsListInputSchema = z
  .object({
    timeRange: TimeRangeSchema,
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    repo: z.string().optional(),
    branch: z.string().optional(),
    conclusion: z.string().optional(),
    workflowName: z.string().optional(),
    runId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.page !== undefined && value.offset !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either page or offset, not both.",
        path: ["offset"],
      });
    }

    if (value.limit !== undefined && value.pageSize !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either limit or pageSize, not both.",
        path: ["limit"],
      });
    }
  });
export type RunsListInput = z.infer<typeof RunsListInputSchema>;

export interface FilterOptions {
  repos: string[];
  branches: string[];
  workflowNames: string[];
}

export interface RunSearchResult {
  traceId: string;
  runId: string;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  timestamp: string;
}

export const SearchRunsInputSchema = z.object({
  query: z.string().min(1),
});
