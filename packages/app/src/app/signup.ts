import { and, eq, gt } from "drizzle-orm";
import { invitationIdFromRedirect } from "#app/common/invitation.ts";
import { db } from "#app/db/client.ts";
import { invitation } from "#app/db/schema/index.ts";
import { getInstallation } from "./installation.server";

export async function canOpenSignup(data: { redirect?: string }) {
  const invitationId = invitationIdFromRedirect(data.redirect);
  const workspace = await getInstallation(db);
  if (!invitationId || !workspace) return false;
  const [invite] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.organizationId, workspace.id),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(invite);
}
