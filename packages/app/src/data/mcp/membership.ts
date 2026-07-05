import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { member } from "@/db/schema";

export class McpMembershipError extends Error {}

/** Throws McpMembershipError if the user is not a current member of the org. */
export async function assertCurrentMember(userId: string, organizationId: string): Promise<void> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) {
    throw new McpMembershipError("Not a member of the requested organization.");
  }
}
