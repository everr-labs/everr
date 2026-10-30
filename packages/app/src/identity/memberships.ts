import { and, eq, ne } from "drizzle-orm";
import type { Transaction } from "#app/db/database.ts";
import { invitation, member } from "#app/db/schema/index.ts";
import { isOrganizationOwner } from "#app/lib/organization-role.ts";
import { IdentityPolicyError } from "./policy-error";

/** Restrict collaboration inside the caller's transaction after application eligibility checks. */
export async function restrictOrganizationToOwner(
  transaction: Transaction,
  { organizationId, ownerId }: { organizationId: string; ownerId: string },
) {
  const [retained] = await transaction
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, ownerId)))
    .limit(1);
  if (!retained || !isOrganizationOwner(retained.role)) {
    throw new IdentityPolicyError("The retained member must be an organization owner.");
  }
  const removed = await transaction
    .delete(member)
    .where(and(eq(member.organizationId, organizationId), ne(member.userId, ownerId)))
    .returning({ id: member.id, organizationId: member.organizationId, userId: member.userId });
  const canceled = await transaction
    .update(invitation)
    .set({ status: "canceled" })
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, "pending")))
    .returning({ id: invitation.id });
  return {
    removedMemberships: removed,
    removedMembers: removed.length,
    canceledInvitations: canceled.length,
  };
}
