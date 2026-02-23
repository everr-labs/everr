import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@workos/authkit-tanstack-react-start";

import {
  ensureTenantForOrganizationId,
  GithubInstallationAlreadyLinkedError,
  linkGithubInstallationToTenant,
} from "@/data/tenants";
import { parseInstallState } from "@/lib/github-install-state";

function redirectToDashboard(
  origin: string,
  status: string,
  reason?: string,
): Response {
  const url = new URL("/dashboard", origin);
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

        const auth = await getAuth();
        if (!auth.user) {
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

        if (parsedState.userId !== auth.user.id) {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "state_user_mismatch",
          );
        }
        if (!auth.organizationId) {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "missing_org",
          );
        }
        if (parsedState.organizationId !== auth.organizationId) {
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "state_org_mismatch",
          );
        }

        try {
          const tenantId = await ensureTenantForOrganizationId(
            auth.organizationId,
          );
          await linkGithubInstallationToTenant(installationId, tenantId);
        } catch (error) {
          if (error instanceof GithubInstallationAlreadyLinkedError) {
            return redirectToDashboard(
              callbackURL.origin,
              "error",
              "already_linked",
            );
          }
          return redirectToDashboard(
            callbackURL.origin,
            "error",
            "link_failed",
          );
        }

        return redirectToDashboard(callbackURL.origin, "linked");
      },
    },
  },
});
