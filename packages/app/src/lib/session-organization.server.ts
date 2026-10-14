import { and, eq, gt } from "drizzle-orm";
import { type Database, type DbExecutor, db } from "@/db/client";
import { member, organization, session as sessions } from "@/db/schema";
import { selectSoleOrganization } from "@/lib/auto-org";

type SessionIdentity = {
  id: string;
  userId: string;
  activeOrganizationId?: string | null;
};

async function isMember(
  database: DbExecutor,
  userId: string,
  organizationId: string,
) {
  const [membership] = await database
    .select({ id: member.id })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);
  return Boolean(membership);
}

// Recover selection only, never create membership or pick between workspaces.
export async function resolveSessionOrganization(
  session: SessionIdentity,
  database: Database = db,
): Promise<{ activeOrganizationId: string | null } | null> {
  if (
    session.activeOrganizationId &&
    (await isMember(database, session.userId, session.activeOrganizationId))
  ) {
    return { activeOrganizationId: session.activeOrganizationId };
  }
  return database.transaction(async (tx) => {
    // Read again under the session lock so recovery preserves a newer selection.
    const [current] = await tx
      .select({
        activeOrganizationId: sessions.activeOrganizationId,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, session.id),
          eq(sessions.userId, session.userId),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .for("update");
    if (!current) return null;
    if (
      current.activeOrganizationId &&
      (await isMember(tx, session.userId, current.activeOrganizationId))
    ) {
      return current;
    }
    const memberships = await tx
      .select({ id: organization.id })
      .from(organization)
      .innerJoin(member, eq(member.organizationId, organization.id))
      .where(eq(member.userId, session.userId))
      .limit(2);
    const activeOrganizationId = selectSoleOrganization(
      memberships.map(({ id }) => id),
    );
    if (activeOrganizationId !== current.activeOrganizationId) {
      await tx
        .update(sessions)
        .set({ activeOrganizationId })
        .where(eq(sessions.id, session.id));
    }
    return { activeOrganizationId };
  });
}
