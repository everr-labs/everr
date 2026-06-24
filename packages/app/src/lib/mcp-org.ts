import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { member, session } from "@/db/schema";

export class McpOrgError extends Error {}

/**
 * Resolve the organization an MCP query runs against:
 *   1. the user's last-used org — the most-recent session's activeOrganizationId
 *      that they are STILL a member of (validated inline by the join); else
 *   2. their first organization membership (earliest joined).
 * Throws McpOrgError if the user belongs to no organization. Membership is read
 * live, so a revoked user never resolves to that org.
 */
export async function resolveMcpOrg(userId: string): Promise<string> {
  // One round-trip on the happy path: joining session→member returns the active
  // org only when it is a current membership. A stale or missing active org
  // yields no row and falls through to the first-membership query below.
  const lastUsed = await db
    .select({ organizationId: member.organizationId })
    .from(session)
    .innerJoin(
      member,
      and(
        eq(member.userId, session.userId),
        eq(member.organizationId, session.activeOrganizationId),
      ),
    )
    .where(
      and(eq(session.userId, userId), isNotNull(session.activeOrganizationId)),
    )
    .orderBy(desc(session.updatedAt), desc(session.id))
    .limit(1);

  if (lastUsed[0]?.organizationId) {
    return lastUsed[0].organizationId;
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
