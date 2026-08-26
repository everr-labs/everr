import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { invitation, member, organization, user } from "@/db/schema";
import { auth } from "@/lib/auth.server";
import {
  createAuthenticatedServerFn,
  createPartiallyAuthenticatedServerFn,
} from "@/lib/serverFn";
import { assertInvitationRecipientAllowed } from "@/lib/service-account-member-guards.server";
import {
  deriveInvitationLookup,
  type InvitationLookup,
} from "./invite-resolver";

export type { InviteLoaderResult } from "./invite-resolver";
export { resolveInvitationLoader } from "./invite-resolver";

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

    return deriveInvitationLookup(row);
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

const InviteMemberInput = z
  .object({
    email: z.string().trim().min(1, "Email is required"),
    role: z.enum(["member", "admin", "owner"]),
  })
  .strict();

// A service account's membership comes from the account itself, so an
// invitation to one is a dead end. The same guard runs on the organization
// plugin's `beforeCreateInvitation` hook, which is the security boundary
// (`/organization/invite-member` is client-callable and bypasses this server
// function); calling it here gives the UI the refusal before the round trip.
export const inviteMember = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(InviteMemberInput)
  .handler(async ({ data }) => {
    await assertInvitationRecipientAllowed(data.email);

    return auth.api.createInvitation({
      body: { email: data.email, role: data.role },
      headers: getRequestHeaders(),
    });
  });
