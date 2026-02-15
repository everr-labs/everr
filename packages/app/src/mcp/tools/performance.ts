import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getDurationTrends,
  getQueueTimeAnalysis,
  getSuccessRateTrends,
} from "@/data/analytics";
import {
  getFailurePatterns,
  getFailuresByRepo,
  getFailureTrend,
} from "@/data/failures";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

function resolveInputTimeRange(args: { from?: string; to?: string }) {
  return {
    from: args.from ?? DEFAULT_TIME_RANGE.from,
    to: args.to ?? DEFAULT_TIME_RANGE.to,
  };
}

export function registerPerformanceTools(server: McpServer) {
  server.tool(
    "get_performance_trends",
    "Get performance trends over time: duration metrics (avg, p50, p95), queue time analysis, and success rate trends. Useful for spotting performance regressions or improvements.",
    {
      from: z
        .string()
        .optional()
        .describe("Start of time range (e.g. 'now-7d'). Defaults to 'now-7d'."),
      to: z
        .string()
        .optional()
        .describe("End of time range. Defaults to 'now'."),
    },
    async (args) => {
      const timeRange = resolveInputTimeRange(args);
      const [duration, queueTime, successRate] = await Promise.all([
        getDurationTrends({ data: { timeRange } }),
        getQueueTimeAnalysis({ data: { timeRange } }),
        getSuccessRateTrends({ data: { timeRange } }),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              durationTrends: duration,
              queueTimeTrends: queueTime,
              successRateTrends: successRate,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "get_failure_analysis",
    "Analyze failure patterns: common failure types with sample traceIds for investigation, failure trends over time, and failures broken down by repository. Useful for identifying systemic issues.",
    {
      from: z
        .string()
        .optional()
        .describe("Start of time range (e.g. 'now-7d'). Defaults to 'now-7d'."),
      to: z
        .string()
        .optional()
        .describe("End of time range. Defaults to 'now'."),
    },
    async (args) => {
      const timeRange = resolveInputTimeRange(args);
      const [patterns, trend, byRepo] = await Promise.all([
        getFailurePatterns({ data: { timeRange } }),
        getFailureTrend({ data: { timeRange } }),
        getFailuresByRepo({ data: { timeRange } }),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              failurePatterns: patterns,
              failureTrend: trend,
              failuresByRepo: byRepo,
            }),
          },
        ],
      };
    },
  );
}
