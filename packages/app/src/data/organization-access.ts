import { db } from "#app/db/client.ts";
import { findOrganizationForMember } from "#app/lib/organization-membership.server.ts";
import { createPartiallyAuthenticatedServerFn } from "#app/lib/serverFn.ts";

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
