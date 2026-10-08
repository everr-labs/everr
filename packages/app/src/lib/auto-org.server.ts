import { and, eq, gt, sql } from "drizzle-orm";
import { type Database, db } from "@/db/client";
import { invitation, member, session as sessionTable, user } from "@/db/schema";
import {
  deriveOrgName,
  generateOrgSlug,
  selectSoleOrganization,
  shouldCreateAutomaticOrganization,
} from "@/lib/auto-org";
import { lockHobbyOrganizationOwnership } from "@/lib/billing-data.server";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

type CreateAutomaticOrganization = (body: {
  name: string;
  slug: string;
  userId: string;
  plan: "hobby";
}) => Promise<{ id: string } | null>;

// Better Auth runs session after-hooks after the signup transaction commits.
// The ownership check and organization creation can then see the new user.
export function createAutomaticOrganizationSessionHook(
  createOrganization: CreateAutomaticOrganization,
  database: Database = db,
) {
  return async (session: {
    id: string;
    userId: string;
    activeOrganizationId?: string | null;
  }) => {
    if (session.activeOrganizationId) return;
    try {
      const activeOrganizationId = await ensureAutomaticOrganization(
        session.userId,
        createOrganization,
        database,
      );
      if (!activeOrganizationId) return;
      await database
        .update(sessionTable)
        .set({ activeOrganizationId })
        .where(eq(sessionTable.id, session.id));
      session.activeOrganizationId = activeOrganizationId;
    } catch (error) {
      serverLogger.error("auto_org.create_personal_org.failed", {
        ...exceptionAttributes(error),
        "user.id": session.userId,
      });
    }
  };
}

export async function ensureAutomaticOrganization(
  userId: string,
  createOrganization: CreateAutomaticOrganization,
  database: Database = db,
): Promise<string | null> {
  return database.transaction(async (tx) => {
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
    if (
      !shouldCreateAutomaticOrganization({
        membershipCount: memberships.length,
        hasPendingInvitation: pendingInvitations.length > 0,
      })
    )
      return null;

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
