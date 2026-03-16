import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWatchStatus } from "@/data/watch";
import { cliAuthMiddleware } from "../-auth";

const WatchQuerySchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1),
  commit: z.string().min(1),
});

export const Route = createFileRoute("/api/cli/runs/watch")({
  server: {
    middleware: [cliAuthMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const parsed = WatchQuerySchema.safeParse({
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
          commit: url.searchParams.get("commit") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters for watch. Required: repo, branch, commit.",
            },
            { status: 400 },
          );
        }

        const result = await getWatchStatus({
          tenantId: context.auth.tenantId,
          repo: parsed.data.repo,
          branch: parsed.data.branch,
          commit: parsed.data.commit,
        });

        return Response.json(result);
      },
    },
  },
});
