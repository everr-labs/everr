import { db } from "@/db/client";
import { findOrganizationForMember } from "@/lib/organization-membership.server";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

export const getActiveOrganizationAccess = createPartiallyAuthenticatedServerFn(
  {
    method: "GET",
  },
).handler(async ({ context: { session } }) => {
  const activeOrgId = session.session.activeOrganizationId;
  if (!activeOrgId) return { status: "missing" as const };
  const organization = await findOrganizationForMember(
    db,
    session.user.id,
    activeOrgId,
  );
  return organization
    ? {
        status: "available" as const,
        organization: { id: organization.id, metadata: organization.metadata },
      }
    : { status: "missing" as const };
});
