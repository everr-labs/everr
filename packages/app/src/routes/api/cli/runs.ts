import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunsList } from "@/data/runs-list/server";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";
import { cliAuthMiddleware } from "./-auth";

const RunsListQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    repo: z.string().optional(),
    branch: z.string().optional(),
    conclusion: z.string().optional(),
    workflowName: z.string().optional(),
    runId: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/api/cli/runs")({
  server: {
    middleware: [cliAuthMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = RunsListQuerySchema.safeParse(
          Object.fromEntries(url.searchParams.entries()),
        );

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters for runs listing. Check limit, offset, and filter values.",
            },
            { status: 400 },
          );
        }

        const result = await getRunsList({
          data: {
            timeRange: {
              from: parsed.data.from ?? DEFAULT_TIME_RANGE.from,
              to: parsed.data.to ?? DEFAULT_TIME_RANGE.to,
            },
            limit: parsed.data.limit,
            offset: parsed.data.offset,
            repo: parsed.data.repo,
            branch: parsed.data.branch,
            conclusion: parsed.data.conclusion,
            workflowName: parsed.data.workflowName,
            runId: parsed.data.runId,
          },
        });

        return Response.json(result);
      },
    },
  },
});
