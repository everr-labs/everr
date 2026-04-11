import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRunsList } from "@/data/runs-list/server";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

const RunsListQuerySchema = z.strictObject({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  conclusion: z.enum(["success", "failure", "cancellation"]).optional(),
  workflowName: z.string().optional(),
  runId: z.string().optional(),
  authorEmails: z.array(z.string()).optional(),
});

export const Route = createFileRoute("/api/cli/runs")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const authorEmails = url.searchParams.getAll("authorEmails");
        const parsed = RunsListQuerySchema.safeParse({
          ...Object.fromEntries(url.searchParams.entries()),
          authorEmails: authorEmails.length > 0 ? authorEmails : undefined,
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

        const timeRange = {
          from: parsed.data.from ?? DEFAULT_TIME_RANGE.from,
          to: parsed.data.to ?? DEFAULT_TIME_RANGE.to,
        };

        const result = await getRunsList({
          data: {
            timeRange,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
            repos: parsed.data.repo ? [parsed.data.repo] : undefined,
            branches: parsed.data.branch ? [parsed.data.branch] : undefined,
            conclusions: parsed.data.conclusion
              ? [parsed.data.conclusion]
              : undefined,
            workflowNames: parsed.data.workflowName
              ? [parsed.data.workflowName]
              : undefined,
            runId: parsed.data.runId,
            authorEmails: parsed.data.authorEmails,
          },
        });

        return Response.json({
          ...result,
          filters: {
            from: timeRange.from,
            to: timeRange.to,
            repo: parsed.data.repo ?? undefined,
            branch: parsed.data.branch ?? undefined,
            conclusion: parsed.data.conclusion ?? undefined,
            workflowName: parsed.data.workflowName ?? undefined,
            runId: parsed.data.runId ?? undefined,
            authorEmails: parsed.data.authorEmails,
            limit: parsed.data.limit ?? 20,
            offset: parsed.data.offset ?? 0,
          },
        });
      },
    },
  },
});
