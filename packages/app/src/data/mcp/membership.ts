import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { member, organization } from "@/db/schema";

export class McpMembershipError extends Error {}

/** Throws McpMembershipError if the user is not a current member of the org. */
export async function assertCurrentMember(
  userId: string,
  organizationId: string,
) {
  const rows = await db
    .select({ metadata: organization.metadata })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);
  if (!rows[0]) {
    throw new McpMembershipError("Not a member of the requested organization.");
  }
  return rows[0];
}
