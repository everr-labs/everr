import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getBranchStatus } from "@/data/branch-status";

const WatchQuerySchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1).optional(),
  commit: z.string().min(1),
  attempt: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/api/cli/runs/status")({
  server: {
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const parsed = WatchQuerySchema.safeParse({
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
          commit: url.searchParams.get("commit") ?? undefined,
          attempt: url.searchParams.get("attempt") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters for status. Required: repo, branch, commit.",
            },
            { status: 400 },
          );
        }

        const result = await getBranchStatus({
          tenantId: context.session.session.activeOrganizationId,
          ...parsed.data,
        });
        return Response.json(result);
      },
    },
  },
});
