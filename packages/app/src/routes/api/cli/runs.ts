import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunsList } from "@/data/runs-list";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";
import { cliTokenAuthMiddleware } from "./-token-auth";

const RunsListQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  conclusion: z.string().optional(),
  workflowName: z.string().optional(),
  runId: z.string().optional(),
});

export const Route = createFileRoute("/api/cli/runs")({
  server: {
    middleware: [cliTokenAuthMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = RunsListQuerySchema.safeParse({
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          page: url.searchParams.get("page") ?? undefined,
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
          conclusion: url.searchParams.get("conclusion") ?? undefined,
          workflowName: url.searchParams.get("workflowName") ?? undefined,
          runId: url.searchParams.get("runId") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters for runs listing. Check page and filter values.",
            },
            { status: 400 },
          );
        }

        const data = parsed.data;
        const result = await getRunsList({
          data: {
            timeRange: {
              from: data.from ?? DEFAULT_TIME_RANGE.from,
              to: data.to ?? DEFAULT_TIME_RANGE.to,
            },
            page: data.page ?? 1,
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
