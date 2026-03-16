import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import {
  getFailureNotifications,
  getVerifiedCliUserEmail,
} from "@/routes/api/cli/-failure-notifications";

const FailuresQuerySchema = z.object({
  gitEmail: z.string().email(),
  repo: z.string().optional(),
  branch: z.string().optional(),
});

export const Route = createFileRoute("/api/cli/notifier/failures")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const parsed = FailuresQuerySchema.safeParse({
          gitEmail: url.searchParams.get("gitEmail") ?? undefined,
          repo: url.searchParams.get("repo") ?? undefined,
          branch: url.searchParams.get("branch") ?? undefined,
        });

        if (!parsed.success) {
          return Response.json(
            {
              error:
                "Invalid query parameters. Required: gitEmail. Optional: repo, branch.",
            },
            { status: 400 },
          );
        }

        const verifiedEmail = await getVerifiedCliUserEmail(
          context.session.userId,
          parsed.data.gitEmail,
        );
        if (!verifiedEmail) {
          return Response.json([]);
        }

        const failures = await getFailureNotifications({
          tenantId: context.session.tenantId,
          gitEmail: verifiedEmail,
          origin: url.origin,
          timeWindowMinutes: 5,
          repo: parsed.data.repo,
          branch: parsed.data.branch,
          preloadNotificationContext: true,
        });

        return Response.json(failures);
      },
    },
  },
});
