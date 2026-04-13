import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { githubInstallationOrganizations } from "@/db/schema";
import { auth } from "@/lib/auth.server";
import { parseInstallState } from "@/lib/github-install-state";

function redirectToDashboard(
  origin: string,
  status: string,
  reason?: string,
): Response {
  const url = new URL("/", origin);
  url.searchParams.set("github_install", status);
  if (reason) {
    url.searchParams.set("reason", reason);
  }
  return Response.redirect(url.toString(), 302);
}

export const Route = createFileRoute("/api/github/install/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const callbackURL = new URL(request.url);
        const installationIdParam =
          callbackURL.searchParams.get("installation_id");
        const state = callbackURL.searchParams.get("state");
        if (!installationIdParam || !state) {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "missing_params",
          );
        }

        const installationId = Number(installationIdParam);
        if (!Number.isSafeInteger(installationId) || installationId <= 0) {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "invalid_installation_id",
          );
        }

        const session = await auth.api.getSession({
          headers: request.headers,
        });
        if (!session?.user) {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "unauthenticated",
          );
        }

        let parsedState: { organizationId: string; userId: string };
        try {
          parsedState = parseInstallState(state);
        } catch {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "invalid_state",
          );
        }

        if (parsedState.userId !== session.user.id) {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "state_user_mismatch",
          );
        }

        const activeOrgId = session.session.activeOrganizationId;
        if (!activeOrgId) {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "missing_org",
          );
        }
        if (parsedState.organizationId !== activeOrgId) {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "state_org_mismatch",
          );
        }

        try {
          const [existing] = await db
            .select({
              githubInstallationId:
                githubInstallationOrganizations.githubInstallationId,
              organizationId: githubInstallationOrganizations.organizationId,
            })
            .from(githubInstallationOrganizations)
            .where(
              eq(
                githubInstallationOrganizations.githubInstallationId,
                installationId,
              ),
            )
            .limit(1);

          if (existing) {
            if (existing.organizationId !== activeOrgId) {
              return redirectToDashboard(
                callbackURL.origin,
                "error",
                "already_linked",
              );
            }

            await db
              .update(githubInstallationOrganizations)
              .set({
                status: "active",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(
                    githubInstallationOrganizations.githubInstallationId,
                    installationId,
                  ),
                  eq(
                    githubInstallationOrganizations.organizationId,
                    activeOrgId,
                  ),
                ),
              );
          } else {
            await db.insert(githubInstallationOrganizations).values({
              githubInstallationId: installationId,
              organizationId: activeOrgId,
              status: "active",
            });
          }
        } catch {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "link_failed",
          );
        }

        // TODO: When installing the GitHub app via the web app, the user is shown this. This should only happen when the installation happens via the Desktop App or the CLI.
        // When installing via the app, we should redirect to the dashboard.
        return new Response(
          `<!DOCTYPE html>
<html><head><title>GitHub App Installed</title></head>
<body><p>Installation successful. You may close this tab.</p>
<script>window.close()</script></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      },
    },
  },
});
