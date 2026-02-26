import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRunnerUtilization } from "@/data/analytics";
import {
  getCostByRepo,
  getCostByWorkflow,
  getCostOverview,
} from "@/data/cost-analysis";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

function resolveInputTimeRange(args: { from?: string; to?: string }) {
  return {
    from: args.from ?? DEFAULT_TIME_RANGE.from,
    to: args.to ?? DEFAULT_TIME_RANGE.to,
  };
}

export function registerCostsTools(server: McpServer) {
  server.registerTool(
    "get_cost_analysis",
    {
      description:
        "Get CI/CD cost breakdown: total estimated cost, cost by OS and runner tier, daily cost trend, cost per repository, and cost per workflow. Useful for identifying cost optimization opportunities.",
      inputSchema: {
        from: z
          .string()
          .optional()
          .describe(
            "Start of time range (e.g. 'now-7d'). Defaults to 'now-7d'.",
          ),
        to: z
          .string()
          .optional()
          .describe("End of time range. Defaults to 'now'."),
      },
    },
    async (args) => {
      const timeRange = resolveInputTimeRange(args);
      const [overview, byRepo, byWorkflow] = await Promise.all([
        getCostOverview({ data: { timeRange } }),
        getCostByRepo({ data: { timeRange } }),
        getCostByWorkflow({ data: { timeRange } }),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              overview,
              costByRepo: byRepo,
              costByWorkflow: byWorkflow,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_runner_utilization",
    {
      description:
        "Get runner performance metrics: number of jobs, average duration, and success rate per runner label. Useful for identifying underperforming or overloaded runners.",
      inputSchema: {
        from: z
          .string()
          .optional()
          .describe(
            "Start of time range (e.g. 'now-7d'). Defaults to 'now-7d'.",
          ),
        to: z
          .string()
          .optional()
          .describe("End of time range. Defaults to 'now'."),
      },
    },
    async (args) => {
      const timeRange = resolveInputTimeRange(args);
      const utilization = await getRunnerUtilization({ data: { timeRange } });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(utilization) }],
      };
    },
  );
}
