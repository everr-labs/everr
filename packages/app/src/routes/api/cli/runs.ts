import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunsList, RunLifecycleStatusSchema } from "@/data/runs-list";
import { getWaitPipelineStatus } from "@/data/wait-pipeline";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";
import { cliAuthMiddleware } from "./-auth";

const RunsListQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  status: RunLifecycleStatusSchema.optional(),
  conclusion: z.string().optional(),
  workflowName: z.string().optional(),
  runId: z.string().optional(),
  commit: z.string().optional(),
  waitMode: z.enum(["pipeline"]).optional(),
});

export const Route = createFileRoute("/api/cli/runs")({
  server: {
    middleware: [cliAuthMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.has("page")) {
          return Response.json(
            {
              error:
                "Invalid query parameters for runs listing. Check limit, offset, and filter values.",
            },
            { status: 400 },
          );
        }

        const parsed = RunsListQuerySchema.safeParse({
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined,
          offset: url.searchParams.get("offset") ?? undefined,
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          conclusion: url.searchParams.get("conclusion") ?? undefined,
          workflowName: url.searchParams.get("workflowName") ?? undefined,
          runId: url.searchParams.get("runId") ?? undefined,
          commit: url.searchParams.get("commit") ?? undefined,
          waitMode: url.searchParams.get("waitMode") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters for runs listing. Check limit, offset, and filter values.",
            },
            { status: 400 },
          );
        }

        const data = parsed.data;
        if (data.waitMode === "pipeline") {
          if (!data.repo || !data.branch || !data.commit) {
            return Response.json(
              {
                error:
                  "Invalid query parameters for wait-pipeline. Required: repo, branch, commit.",
              },
              { status: 400 },
            );
          }

          const result = await getWaitPipelineStatus({
            data: {
              repo: data.repo,
              branch: data.branch,
              commit: data.commit,
            },
          });

          return Response.json(result);
        }

        const result = await getRunsList({
          data: {
            timeRange: {
              from: data.from ?? DEFAULT_TIME_RANGE.from,
              to: data.to ?? DEFAULT_TIME_RANGE.to,
            },
            limit: data.limit,
            offset: data.offset,
            repo: data.repo,
            branch: data.branch,
            status: data.status,
            conclusion: data.conclusion,
            workflowName: data.workflowName,
            runId: data.runId,
          },
        });

        return Response.json(result);
      },
    },
  },
});
