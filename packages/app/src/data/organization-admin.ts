import type { QueryClient } from "@tanstack/react-query";
import type { getActiveOrganizationAccess } from "#app/data/organization-access.ts";
import { isOrganizationAdmin, NotOrganizationAdminError } from "#app/lib/organization-role.ts";
import { organizationAccessKey, refetchRouteAccess } from "#app/lib/route-access-cache.ts";

export { NotOrganizationAdminError };

type OrganizationAccess = Awaited<ReturnType<typeof getActiveOrganizationAccess>>;

// Route guard for the admin pages. The admin server functions check the role
// themselves; this only picks the page.
export async function requireOrganizationAdmin({
  context: { memberRole, session, queryClient },
}: {
  context: {
    memberRole: string;
    session: { session: { id: string; activeOrganizationId?: string | null } };
    queryClient: QueryClient;
  };
}) {
  if (isOrganizationAdmin(memberRole)) return;
  // The role is cached, and a promotion made elsewhere does not reset it.
  const access = await refetchRouteAccess<OrganizationAccess>(
    queryClient,
    organizationAccessKey(session),
  );
  if (access?.status === "available" && isOrganizationAdmin(access.memberRole))
    return { memberRole: access.memberRole };
  throw new NotOrganizationAdminError();
}
