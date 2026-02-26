import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getFlakyTestSummary,
  getFlakyTests,
  getRunnerFlakiness,
  getTestHistory,
} from "@/data/flaky-tests";
import {
  getSlowestTests,
  getTestResultsByPackage,
  getTestResultsSummary,
} from "@/data/test-results";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

function resolveInputTimeRange(args: { from?: string; to?: string }) {
  return {
    from: args.from ?? DEFAULT_TIME_RANGE.from,
    to: args.to ?? DEFAULT_TIME_RANGE.to,
  };
}

export function registerTestsTools(server: McpServer) {
  server.registerTool(
    "get_test_results_summary",
    {
      description:
        "Get test health overview: total tests, pass/fail/skip counts, per-package breakdown, and slowest tests. Useful for understanding overall test suite health.",
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
      const [summary, byPackage, slowest] = await Promise.all([
        getTestResultsSummary({ data: { timeRange } }),
        getTestResultsByPackage({ data: { timeRange } }),
        getSlowestTests({ data: { timeRange } }),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ summary, byPackage, slowestTests: slowest }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_flaky_tests",
    {
      description:
        "Identify flaky tests with their failure rates, execution counts, and flakiness scores. Filterable by repository, branch, or search term. Returns a summary and list of flaky tests.",
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
        repo: z.string().optional().describe("Filter by repository name."),
        branch: z.string().optional().describe("Filter by branch name."),
        search: z.string().optional().describe("Search for tests by name."),
      },
    },
    async (args) => {
      const timeRange = resolveInputTimeRange(args);
      const filterInput = {
        data: {
          timeRange,
          repo: args.repo,
          branch: args.branch,
          search: args.search,
        },
      };

      const [summary, tests] = await Promise.all([
        getFlakyTestSummary(filterInput),
        getFlakyTests(filterInput),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ summary, flakyTests: tests }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_test_history",
    {
      description:
        "Get detailed execution history of a specific test, including per-execution results and runner-level flakiness analysis. Requires the full test name and repository.",
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
        repo: z.string().describe("The repository name."),
        testFullName: z
          .string()
          .describe("The full name of the test to inspect."),
      },
    },
    async (args) => {
      const timeRange = resolveInputTimeRange(args);
      const input = {
        data: { timeRange, repo: args.repo, testFullName: args.testFullName },
      };

      const [history, runnerFlakiness] = await Promise.all([
        getTestHistory(input),
        getRunnerFlakiness(input),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ history, runnerFlakiness }),
          },
        ],
      };
    },
  );
}
