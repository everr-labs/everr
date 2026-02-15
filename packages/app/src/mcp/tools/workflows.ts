import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getWorkflowCost,
  getWorkflowDurationTrend,
  getWorkflowFailureReasons,
  getWorkflowRecentRuns,
  getWorkflowStats,
  getWorkflowSuccessRateTrend,
  getWorkflowTopFailingJobs,
} from "@/data/workflows";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

function resolveInputTimeRange(args: { from?: string; to?: string }) {
  return {
    from: args.from ?? DEFAULT_TIME_RANGE.from,
    to: args.to ?? DEFAULT_TIME_RANGE.to,
  };
}

export function registerWorkflowsTools(server: McpServer) {
  server.tool(
    "get_workflow_details",
    "Get comprehensive analysis of a specific workflow: stats with previous period comparison, success rate and duration trends, top failing jobs, failure reasons, estimated cost, and recent runs. Requires workflowName and repo.",
    {
      from: z
        .string()
        .optional()
        .describe("Start of time range (e.g. 'now-7d'). Defaults to 'now-7d'."),
      to: z
        .string()
        .optional()
        .describe("End of time range. Defaults to 'now'."),
      workflowName: z.string().describe("The workflow name to analyze."),
      repo: z.string().describe("The repository (e.g. 'owner/repo')."),
    },
    async (args) => {
      const timeRange = resolveInputTimeRange(args);
      const input = {
        data: { timeRange, workflowName: args.workflowName, repo: args.repo },
      };

      const [
        stats,
        successTrend,
        durationTrend,
        failingJobs,
        failureReasons,
        cost,
        recentRuns,
      ] = await Promise.all([
        getWorkflowStats(input),
        getWorkflowSuccessRateTrend(input),
        getWorkflowDurationTrend(input),
        getWorkflowTopFailingJobs(input),
        getWorkflowFailureReasons(input),
        getWorkflowCost(input),
        getWorkflowRecentRuns(input),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              stats,
              successRateTrend: successTrend,
              durationTrend,
              topFailingJobs: failingJobs,
              failureReasons,
              cost,
              recentRuns,
            }),
          },
        ],
      };
    },
  );
}
