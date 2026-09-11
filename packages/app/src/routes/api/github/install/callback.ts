import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { githubInstallationOrganizations, member } from "@/db/schema";
import { auth } from "@/lib/auth.server";
import { parseInstallState } from "@/lib/github-install-state";

function redirectToGithub(
  origin: string,
  status: string,
  reason?: string,
): Response {
  const url = new URL("/github", origin);
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
          return redirectToGithub(
            callbackURL.origin,
            "error",
            "missing_params",
          );
        }

        const installationId = Number(installationIdParam);
        if (!Number.isSafeInteger(installationId) || installationId <= 0) {
          return redirectToGithub(
            callbackURL.origin,
            "error",
            "invalid_installation_id",
          );
        }

        const session = await auth.api.getSession({
          headers: request.headers,
        });
        if (!session?.user) {
          return redirectToGithub(
            callbackURL.origin,
            "error",
            "unauthenticated",
          );
        }

        let parsedState: { organizationId: string; userId: string };
        try {
          parsedState = parseInstallState(state);
        } catch {
          return redirectToGithub(callbackURL.origin, "error", "invalid_state");
        }

        if (parsedState.userId !== session.user.id) {
          return redirectToGithub(
            callbackURL.origin,
            "error",
            "state_user_mismatch",
          );
        }

        const [currentMembership] = await db
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.userId, session.user.id),
              eq(member.organizationId, parsedState.organizationId),
            ),
          )
          .limit(1);
        if (!currentMembership) {
          return redirectToGithub(
            callbackURL.origin,
            "error",
            "membership_missing",
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
            if (existing.organizationId !== parsedState.organizationId) {
              return redirectToGithub(
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
                    parsedState.organizationId,
                  ),
                ),
              );
          } else {
            await db.insert(githubInstallationOrganizations).values({
              githubInstallationId: installationId,
              organizationId: parsedState.organizationId,
              status: "active",
            });
          }
        } catch {
          return redirectToGithub(callbackURL.origin, "error", "link_failed");
        }

        // The installation runs in a popup. The originating GitHub page polls
        // the organization status and updates when this window closes.
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
