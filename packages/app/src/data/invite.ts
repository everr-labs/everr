import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { invitation, member, organization, user } from "@/db/schema";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

export type InvitationLookup =
  | { status: "not-found" }
  | {
      status: "inactive";
      reason: "expired" | "canceled" | "rejected";
      organizationName: string;
    }
  | {
      status: "accepted";
      organizationId: string;
      organizationName: string;
      invitedEmail: string;
    }
  | {
      status: "pending";
      organizationId: string;
      organizationName: string;
      invitedEmail: string;
      role: string | null;
      inviterName: string;
    };

export const lookupInvitation = createServerFn({ method: "GET" })
  .inputValidator(z.object({ invitationId: z.string() }))
  .handler(async ({ data: { invitationId } }): Promise<InvitationLookup> => {
    const [row] = await db
      .select({
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        organizationId: invitation.organizationId,
        organizationName: organization.name,
        inviterName: user.name,
      })
      .from(invitation)
      .innerJoin(organization, eq(organization.id, invitation.organizationId))
      .innerJoin(user, eq(user.id, invitation.inviterId))
      .where(eq(invitation.id, invitationId))
      .limit(1);

    if (!row) return { status: "not-found" };

    if (row.status === "accepted") {
      return {
        status: "accepted",
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        invitedEmail: row.email,
      };
    }

    if (row.status === "canceled" || row.status === "rejected") {
      return {
        status: "inactive",
        reason: row.status,
        organizationName: row.organizationName,
      };
    }

    if (row.expiresAt < new Date()) {
      return {
        status: "inactive",
        reason: "expired",
        organizationName: row.organizationName,
      };
    }

    return {
      status: "pending",
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      invitedEmail: row.email,
      role: row.role,
      inviterName: row.inviterName,
    };
  });

export const isMemberOfOrg = createPartiallyAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ organizationId: z.string() }))
  .handler(async ({ data: { organizationId }, context: { session } }) => {
    const [row] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.userId, session.user.id),
          eq(member.organizationId, organizationId),
        ),
      )
      .limit(1);
    return { isMember: Boolean(row) };
  });
