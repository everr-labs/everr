import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { invitation, member, user } from "@/db/schema";
import {
  deriveOrgName,
  generateOrgSlug,
  selectSoleOrganization,
} from "@/lib/auto-org";
import { lockHobbyOrganizationOwnership } from "@/lib/billing-data.server";

export async function ensureAutomaticOrganization(
  userId: string,
  createOrganization: (body: {
    name: string;
    slug: string;
    userId: string;
    plan: "hobby";
  }) => Promise<{ id: string } | null>,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    await lockHobbyOrganizationOwnership(tx, userId);

    // Another sign-in, explicit creation, or downgrade may have added a
    // membership while this request waited for the ownership lock.
    const memberships = await tx
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(2);
    if (memberships.length > 0) {
      return selectSoleOrganization(
        memberships.map((row) => row.organizationId),
      );
    }

    const [userRecord] = await tx
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!userRecord) return null;

    // Invited users should join their destination instead of getting an
    // unrelated personal organization during sign-in.
    const pendingInvitations = await tx
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(
            sql<string>`lower(${invitation.email})`,
            userRecord.email.toLowerCase(),
          ),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (pendingInvitations.length > 0) return null;

    // Better Auth writes through its own connection. Keep the ownership lock
    // until both the organization and its owner membership have been created.
    const created = await createOrganization({
      name: deriveOrgName(userRecord.name, userRecord.email),
      slug: generateOrgSlug(),
      userId,
      plan: "hobby",
    });
    return created?.id ?? null;
  });
}
