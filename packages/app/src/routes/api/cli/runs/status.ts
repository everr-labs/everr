import { createFileRoute } from "@tanstack/react-router";
import { getWatchStatus } from "@/data/watch";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { WatchQuerySchema } from "./watch";

export const Route = createFileRoute("/api/cli/runs/status")({
  server: {
    middleware: [accessTokenAuthMiddleware],
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
                "Invalid query parameters for status. Required: repo, branch, commit.",
            },
            { status: 400 },
          );
        }

        const result = await getWatchStatus({
          tenantId: context.session.tenantId,
          ...parsed.data,
        });
        return Response.json(result);
      },
    },
  },
});
