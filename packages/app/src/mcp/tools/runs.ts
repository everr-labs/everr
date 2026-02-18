import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRunDetails, getRunJobs, getStepLogs } from "@/data/runs";
import { getRunsList } from "@/data/runs-list";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

function resolveInputTimeRange(args: { from?: string; to?: string }) {
  return {
    from: args.from ?? DEFAULT_TIME_RANGE.from,
    to: args.to ?? DEFAULT_TIME_RANGE.to,
  };
}

export function registerRunsTools(server: McpServer) {
  server.tool(
    "list_runs",
    "Search and list CI/CD pipeline runs with optional filters. Returns paginated results with run metadata including status, duration, repository, branch, and workflow name.",
    {
      from: z
        .string()
        .optional()
        .describe("Start of time range (e.g. 'now-7d'). Defaults to 'now-7d'."),
      to: z
        .string()
        .optional()
        .describe("End of time range. Defaults to 'now'."),
      page: z
        .number()
        .optional()
        .describe("Page number (1-based). Defaults to 1."),
      repo: z.string().optional().describe("Filter by repository name."),
      branch: z.string().optional().describe("Filter by branch name."),
      conclusion: z
        .string()
        .optional()
        .describe(
          "Filter by conclusion: 'success', 'failure', or 'cancellation'.",
        ),
      workflowName: z.string().optional().describe("Filter by workflow name."),
      runId: z.string().optional().describe("Filter by specific run ID."),
    },
    async (args) => {
      const timeRange = resolveInputTimeRange(args);
      const result = await getRunsList({
        data: {
          timeRange,
          page: args.page ?? 1,
          repo: args.repo,
          branch: args.branch,
          conclusion: args.conclusion,
          workflowName: args.workflowName,
          runId: args.runId,
        },
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  server.tool(
    "get_run_details",
    "Get full details for a specific pipeline run including its jobs and steps. Provide a traceId (from list_runs results). Returns run metadata, all jobs with their status and duration, and steps for each job.",
    {
      traceId: z.string().describe("The trace ID of the run to inspect."),
    },
    async (args) => {
      const [run, jobs] = await Promise.all([
        getRunDetails({ data: args.traceId }),
        getRunJobs({ data: args.traceId }),
      ]);

      if (!run) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Run not found" }),
            },
          ],
          isError: true,
        };
      }

      const jobIds = jobs.map((j) => j.jobId);
      let steps: Record<string, unknown[]> = {};
      if (jobIds.length > 0) {
        const { getAllJobsSteps } = await import("@/data/runs");
        steps = await getAllJobsSteps({
          data: { traceId: args.traceId, jobIds },
        });
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ run, jobs, steps }) },
        ],
      };
    },
  );

  server.tool(
    "get_step_logs",
    "Retrieve logs for a specific step within a job. Use after get_run_details to drill into a particular step's output. Useful for diagnosing failures.",
    {
      traceId: z.string().describe("The trace ID of the run."),
      jobName: z.string().describe("The name of the job containing the step."),
      stepNumber: z.string().describe("The step number within the job."),
    },
    async (args) => {
      const logs = await getStepLogs({
        data: {
          traceId: args.traceId,
          jobName: args.jobName,
          stepNumber: args.stepNumber,
        },
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(logs) }],
      };
    },
  );
}
