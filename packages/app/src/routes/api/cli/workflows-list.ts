import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWorkflowsList } from "@/data/workflows-list";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";

const WorkflowsListQuerySchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1).optional(),
});

export const Route = createFileRoute("/api/cli/workflows-list")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const parsed = WorkflowsListQuerySchema.safeParse({
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: repo. Optional: branch.",
            },
            { status: 400 },
          );
        }

        const workflows = await getWorkflowsList({
          tenantId: context.session.tenantId,
          repo: parsed.data.repo,
          branch: parsed.data.branch,
        });

        return Response.json({ workflows });
      },
    },
  },
});
