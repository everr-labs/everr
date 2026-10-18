import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "#app/db/client.ts";
import { member, organization } from "#app/db/schema/index.ts";

export async function findOrganizationForMember(
  database: DbExecutor,
  userId: string,
  organizationId: string,
) {
  const [result] = await database
    .select({
      id: organization.id,
      name: organization.name,
      metadata: organization.metadata,
      memberRole: member.role,
    })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(and(eq(organization.id, organizationId), eq(member.userId, userId)))
    .limit(1);
  return result;
}
