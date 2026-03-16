import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getSlowestJobs } from "@/data/cli-insights";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

const SlowestJobsQuerySchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const Route = createFileRoute("/api/cli/slowest-jobs")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = SlowestJobsQuerySchema.safeParse({
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined,
          offset: url.searchParams.get("offset") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: repo. Optional: branch, from, to, limit, offset.",
            },
            { status: 400 },
          );
        }

        const { repo, branch, from, to, limit = 10, offset = 0 } = parsed.data;
        const result = await getSlowestJobs({
          data: {
            repo,
            branch,
            limit,
            offset,
            timeRange: {
              from: from ?? DEFAULT_TIME_RANGE.from,
              to: to ?? DEFAULT_TIME_RANGE.to,
            },
          },
        });

        return Response.json(result);
      },
    },
  },
});
