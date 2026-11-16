import { and, eq } from "drizzle-orm";
import { db } from "#app/db/client.ts";
import { member, oauthConsent, organization } from "#app/db/schema/index.ts";

export class McpGrantError extends Error {}

/**
 * Throws McpGrantError unless the user is still a member of the organization
 * and still consents to this client there. Access tokens outlive both.
 */
export async function assertMcpGrant(userId: string, organizationId: string, clientId: string) {
  const rows = await db
    .select({ metadata: organization.metadata })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .innerJoin(
      oauthConsent,
      and(
        eq(oauthConsent.userId, member.userId),
        eq(oauthConsent.referenceId, member.organizationId),
        eq(oauthConsent.clientId, clientId),
      ),
    )
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) {
    throw new McpGrantError("No current grant for this client in the requested organization.");
  }
  return rows[0];
}
