import { createFileRoute } from "@tanstack/react-router";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import {
  buildAutoFixPrompt,
  buildFailedRunsDashboardUrl,
  getFailureNotifications,
  getVerifiedCliUserEmail,
  TIME_WINDOW_MINUTES,
  type TrayStatusResponse,
} from "@/routes/api/cli/-failure-notifications";

export const Route = createFileRoute("/api/cli/tray-status")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const origin = new URL(request.url).origin;
        const failedRunsDashboardUrl = buildFailedRunsDashboardUrl(origin);
        const verifiedEmail = await getVerifiedCliUserEmail(
          context.session.userId,
        );

        if (!verifiedEmail) {
          return Response.json({
            failures: [],
            dashboardUrl: null,
            autoFixPrompt: null,
          } satisfies TrayStatusResponse);
        }

        const failures = await getFailureNotifications({
          tenantId: context.session.tenantId,
          gitEmail: verifiedEmail,
          origin,
          timeWindowMinutes: TIME_WINDOW_MINUTES,
          unresolvedOnly: true,
        });

        return Response.json({
          failures,
          dashboardUrl: failedRunsDashboardUrl,
          autoFixPrompt:
            failures.length === 0 ? null : buildAutoFixPrompt(failures),
        } satisfies TrayStatusResponse);
      },
    },
  },
});
