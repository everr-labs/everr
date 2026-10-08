import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { isMissingOrganizationError } from "@/common/organization-onboarding";
import { getActiveOrgAppAccess } from "@/data/billing";
import { auth } from "@/lib/auth.server";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

/**
 * Verify the user's active organization is still valid (they're still a member).
 * Missing membership returns the user to organization selection.
 */
const verifyActiveOrg = createPartiallyAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  const activeOrgId = session.session.activeOrganizationId;
  if (!activeOrgId) {
    throw new Error("No active organization");
  }

  // This throws if the user is no longer a member
  const organization = await auth.api.getFullOrganization({
    headers: getRequestHeaders(),
    query: { organizationId: activeOrgId },
  });

  return {
    activeOrganizationId: activeOrgId,
    clickhouseReady: organization?.clickhouseReady === true,
  };
});

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({
    context: { session },
    location: { pathname, href },
  }) => {
    if (!session?.user) {
      // CLI device approval is reached by people setting up a fresh machine, who
      // most often don't have an account yet — send them to sign-up (the page
      // toggles to sign-in and back, preserving this redirect).
      const to = pathname === "/device" ? "/auth/sign-up" : "/auth/sign-in";
      throw redirect({ to, search: { redirect: href } });
    }

    if (pathname === "/account") {
      return {
        clickhouseReady: true,
        session: {
          ...session,
          session: {
            ...session.session,
            // Account settings work without an active organization.
            activeOrganizationId: session.session.activeOrganizationId ?? "",
          },
        },
      };
    }

    const chooseOrganization = () =>
      redirect({
        to: "/choose-organization",
        search: { returnTo: href },
        replace: true,
      });
    if (!session.session.activeOrganizationId) throw chooseOrganization();

    const { activeOrganizationId, clickhouseReady } =
      await verifyActiveOrg().catch((error) => {
        if (isMissingOrganizationError(error)) throw chooseOrganization();
        throw error;
      });
    const entitlement = await getActiveOrgAppAccess();
    if (
      entitlement.appState === "suspended" &&
      pathname !== "/billing/suspended" &&
      pathname !== "/billing"
    ) {
      throw redirect({ to: "/billing/suspended" });
    }

    // The parent guard runs before descendant loaders, so none of the app's
    // data pages can issue queries or render misleading empty states yet.
    if (
      !clickhouseReady &&
      pathname !== "/device" &&
      pathname !== "/billing" &&
      pathname !== "/billing/suspended"
    ) {
      throw redirect({
        to: "/organization-setup",
        search: { returnTo: href },
        replace: true,
      });
    }

    return {
      clickhouseReady,
      session: {
        ...session,
        session: {
          ...session.session,
          activeOrganizationId,
        },
      },
    };
  },
});
