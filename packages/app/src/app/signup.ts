import { and, eq, gt } from "drizzle-orm";
import { invitationIdFromRedirect } from "@/common/invitation";
import { db } from "@/db/client";
import { invitation } from "@/db/schema";
import { getInstallation } from "./installation.server";

export async function canOpenSignup(data: { redirect?: string }) {
  const invitationId = invitationIdFromRedirect(data.redirect);
  const workspace = await getInstallation();
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
