import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { member, session } from "@/db/schema";

export class McpOrgError extends Error {}

async function isCurrentMember(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Resolve the organization an MCP query runs against:
 *   1. the user's last-used org (most-recent session's activeOrganizationId),
 *      if they are still a member of it; otherwise
 *   2. their first organization membership (earliest joined).
 * Throws McpOrgError if the user belongs to no organization.
 */
export async function resolveMcpOrg(userId: string): Promise<string> {
  const recent = await db
    .select({ organizationId: session.activeOrganizationId })
    .from(session)
    .where(
      and(eq(session.userId, userId), isNotNull(session.activeOrganizationId)),
    )
    .orderBy(desc(session.updatedAt), desc(session.id))
    .limit(1);

  const lastUsed = recent[0]?.organizationId;
  if (lastUsed && (await isCurrentMember(userId, lastUsed))) {
    return lastUsed;
  }

  const first = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt), asc(member.id))
    .limit(1);

  const organizationId = first[0]?.organizationId;
  if (!organizationId) {
    throw new McpOrgError("You are not a member of any organization.");
  }
  return organizationId;
}
