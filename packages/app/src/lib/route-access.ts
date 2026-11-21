import { productClient } from "@composition/client";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { getActiveOrganizationAccess } from "#app/data/organization-access.ts";
import type { auth } from "#app/identity/server.ts";
import { expectOrganization } from "#app/lib/expected-organization.ts";
import {
  ensureRouteAccess,
  organizationAccessKey,
  routeAccessQuery,
} from "#app/lib/route-access-cache.ts";

type Session = {
  user: typeof auth.$Infer.Session.user;
  session: Omit<typeof auth.$Infer.Session.session, "token">;
};

export const organizationAccessQuery = (session: Session) =>
  routeAccessQuery(organizationAccessKey(session), () => getActiveOrganizationAccess());

export function requireSession({
  context: { session },
  location,
  matches,
}: {
  context: { session: Session | null };
  location: { href: string };
  matches?: { staticData: { authEntry?: "/auth/sign-up" } }[];
}) {
  if (!session?.user)
    throw redirect({
      to: matches?.some((match) => match.staticData.authEntry === "/auth/sign-up")
        ? "/auth/sign-up"
        : "/auth/sign-in",
      search: { redirect: location.href },
    });
  return { session };
}

export async function requireOrganization({
  context: { session, queryClient },
  location,
  search,
}: {
  context: { session: Session; queryClient: QueryClient };
  location: { href: string };
  search: { returnTo?: string };
}) {
  const missingWorkspace = () =>
    redirect({
      to: productClient.missingWorkspaceRoute,
      search: { returnTo: search.returnTo ?? location.href },
      replace: true,
    });
  if (!session.session.activeOrganizationId) throw missingWorkspace();
  const access = await ensureRouteAccess(
    queryClient,
    organizationAccessQuery(session),
    location.href,
  );
  if (access.status === "missing") throw missingWorkspace();
  expectOrganization(access.organization.id);
  return {
    organization: access.organization,
    memberRole: access.memberRole,
    entryRedirect: access.entryRedirect,
    session: {
      ...session,
      session: {
        ...session.session,
        activeOrganizationId: access.organization.id,
      },
    },
  };
}
