import { redirect } from "@tanstack/react-router";
import { getActiveOrganizationAccess } from "@/data/organization-access";
import type { auth } from "@/lib/auth.server";

type Session = typeof auth.$Infer.Session;

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
      to: matches?.some(
        (match) => match.staticData.authEntry === "/auth/sign-up",
      )
        ? "/auth/sign-up"
        : "/auth/sign-in",
      search: { redirect: location.href },
    });
  return { session };
}

export async function requireOrganization({
  context: { session },
  location,
  search,
}: {
  context: { session: Session };
  location: { href: string };
  search: { returnTo?: string };
}) {
  const chooseOrganization = () =>
    redirect({
      to: "/choose-organization",
      search: { returnTo: search.returnTo ?? location.href },
      replace: true,
    });
  if (!session.session.activeOrganizationId) throw chooseOrganization();
  const access = await getActiveOrganizationAccess();
  if (access.status === "missing") throw chooseOrganization();
  return {
    organization: access.organization,
    session: {
      ...session,
      session: {
        ...session.session,
        activeOrganizationId: access.organization.id,
      },
    },
  };
}
