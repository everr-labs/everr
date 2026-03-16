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
            verified_match: false,
            unresolved_failures: [],
            failed_runs_dashboard_url: failedRunsDashboardUrl,
            auto_fix_prompt: "",
          } satisfies TrayStatusResponse);
        }

        const unresolvedFailures = await getFailureNotifications({
          tenantId: context.auth.tenantId,
          gitEmail: verifiedEmail,
          origin,
          timeWindowMinutes: TIME_WINDOW_MINUTES,
          unresolvedOnly: true,
        });

        return Response.json({
          verified_match: true,
          unresolved_failures: unresolvedFailures,
          failed_runs_dashboard_url: failedRunsDashboardUrl,
          auto_fix_prompt: buildAutoFixPrompt(unresolvedFailures),
        } satisfies TrayStatusResponse);
      },
    },
  },
});
