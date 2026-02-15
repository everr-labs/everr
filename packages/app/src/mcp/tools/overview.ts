import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getDashboardDurationStats,
  getDashboardStats,
  getRepositories,
  getTopFailingJobs,
  getTopFailingWorkflows,
} from "@/data/dashboard-stats";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

const timeRangeParams = {
  from: z
    .string()
    .optional()
    .describe(
      "Start of time range (e.g. 'now-7d', 'now-24h'). Defaults to 'now-7d'.",
    ),
  to: z
    .string()
    .optional()
    .describe("End of time range (e.g. 'now'). Defaults to 'now'."),
};

function resolveInputTimeRange(args: { from?: string; to?: string }) {
  return {
    from: args.from ?? DEFAULT_TIME_RANGE.from,
    to: args.to ?? DEFAULT_TIME_RANGE.to,
  };
}

export function registerOverviewTools(server: McpServer) {
  server.tool(
    "get_dashboard_overview",
    "Get high-level CI/CD health metrics: total runs, success/failure/cancelled counts, success rate, average and p95 durations, and list of repositories. This is the best starting point to understand overall CI/CD health.",
    timeRangeParams,
    async (args) => {
      const timeRange = resolveInputTimeRange(args);
      const [stats, duration, repos] = await Promise.all([
        getDashboardStats({ data: { timeRange } }),
        getDashboardDurationStats({ data: { timeRange } }),
        getRepositories({ data: { timeRange } }),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ stats, duration, repositories: repos }),
          },
        ],
      };
    },
  );

  server.tool(
    "get_top_failures",
    "Get the top 5 failing jobs and top 5 failing workflows. Useful for identifying the most problematic areas in your CI/CD pipeline.",
    timeRangeParams,
    async (args) => {
      const timeRange = resolveInputTimeRange(args);
      const [jobs, workflows] = await Promise.all([
        getTopFailingJobs({ data: { timeRange } }),
        getTopFailingWorkflows({ data: { timeRange } }),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              topFailingJobs: jobs,
              topFailingWorkflows: workflows,
            }),
          },
        ],
      };
    },
  );
}
