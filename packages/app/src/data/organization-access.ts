import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { member, organization as organizationTable } from "@/db/schema";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

export const getActiveOrganizationAccess = createPartiallyAuthenticatedServerFn(
  {
    method: "GET",
  },
).handler(async ({ context: { session } }) => {
  const activeOrgId = session.session.activeOrganizationId;
  if (!activeOrgId) return { status: "missing" as const };
  const [organization] = await db
    .select({ id: organizationTable.id, metadata: organizationTable.metadata })
    .from(organizationTable)
    .innerJoin(member, eq(member.organizationId, organizationTable.id))
    .where(
      and(
        eq(organizationTable.id, activeOrgId),
        eq(member.userId, session.user.id),
      ),
    )
    .limit(1);
  return organization
    ? { status: "available" as const, organization }
    : { status: "missing" as const };
});
