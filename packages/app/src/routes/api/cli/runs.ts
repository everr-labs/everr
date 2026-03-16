import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunsList } from "@/data/runs-list";
import { getWatchStatus } from "@/data/watch";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";
import { cliAuthMiddleware } from "./-auth";

const RunsListQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  conclusion: z.string().optional(),
  workflowName: z.string().optional(),
  runId: z.string().optional(),
  commit: z.string().optional(),
  watchMode: z.enum(["pipeline"]).optional(),
});

export const Route = createFileRoute("/api/cli/runs")({
  server: {
    middleware: [cliAuthMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        if (url.searchParams.has("page") || url.searchParams.has("waitMode")) {
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
          conclusion: url.searchParams.get("conclusion") ?? undefined,
          workflowName: url.searchParams.get("workflowName") ?? undefined,
          runId: url.searchParams.get("runId") ?? undefined,
          commit: url.searchParams.get("commit") ?? undefined,
          watchMode: url.searchParams.get("watchMode") ?? undefined,
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
        if (data.watchMode === "pipeline") {
          if (!data.repo || !data.branch || !data.commit) {
            return Response.json(
              {
                error:
                  "Invalid query parameters for watch. Required: repo, branch, commit.",
              },
              { status: 400 },
            );
          }

          const result = await getWatchStatus({
            data: {
              repo: data.repo,
              branch: data.branch,
              commit: data.commit,
              tenantId: context.auth.tenantId,
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
