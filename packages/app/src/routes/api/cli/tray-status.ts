import { createFileRoute } from "@tanstack/react-router";
import {
  buildAutoFixPrompt,
  buildFailedRunsDashboardUrl,
  getFailureNotifications,
  getVerifiedCliUserEmail,
  TIME_WINDOW_MINUTES,
  type TrayStatusResponse,
} from "@/routes/api/cli/-failure-notifications";
import { cliAuthMiddleware } from "./-auth";

export const Route = createFileRoute("/api/cli/tray-status")({
  server: {
    middleware: [cliAuthMiddleware],
    handlers: {
      GET: async ({ request, context }) => {
        const origin = new URL(request.url).origin;
        const failedRunsDashboardUrl = buildFailedRunsDashboardUrl(origin);
        const verifiedEmail = await getVerifiedCliUserEmail(
          context.auth.userId,
        );

        if (!verifiedEmail) {
          return Response.json({
            failures: [],
            dashboardUrl: null,
            autoFixPrompt: null,
          } satisfies TrayStatusResponse);
        }

        const failures = await getFailureNotifications({
          tenantId: context.auth.tenantId,
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
