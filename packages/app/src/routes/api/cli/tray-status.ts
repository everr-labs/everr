import { createFileRoute } from "@tanstack/react-router";
import {
  buildAutoFixPrompt,
  buildFailedRunsDashboardUrl,
  getFailureNotifications,
  getRunningPipelineCount,
  getVerifiedCliUserEmail,
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
            running_count: 0,
            unresolved_failures: [],
            failed_runs_dashboard_url: failedRunsDashboardUrl,
            auto_fix_prompt: "",
          } satisfies TrayStatusResponse);
        }

        const runningCount = await getRunningPipelineCount(verifiedEmail);
        const unresolvedFailures = await getFailureNotifications({
          gitEmail: verifiedEmail,
          origin,
          timeWindowMinutes: 15,
          unresolvedOnly: true,
        });

        return Response.json({
          verified_match: true,
          running_count: runningCount,
          unresolved_failures: unresolvedFailures,
          failed_runs_dashboard_url: failedRunsDashboardUrl,
          auto_fix_prompt: buildAutoFixPrompt(
            unresolvedFailures,
            failedRunsDashboardUrl,
          ),
        } satisfies TrayStatusResponse);
      },
    },
  },
});
