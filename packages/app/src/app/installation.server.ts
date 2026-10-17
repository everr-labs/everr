import { hashPassword } from "better-auth/crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { type Database, db } from "@/db/client";
import { account, invitation, member, organization, user } from "@/db/schema";
import { isOrganizationOwner } from "@/lib/organization-role";

export class InstallationSetupError extends Error {}

export const SetupWorkspaceSchema = z.object({
  workspaceName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(1).max(100),
  email: z.email().transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
});

export async function getInstallation(database: Database = db) {
  const organizations = await database
    .select({ id: organization.id })
    .from(organization)
    .limit(2);
  if (organizations.length > 1) {
    throw new Error(
      "This installation contains multiple organizations. Use the previous build until an operator has migrated it to a single workspace.",
    );
  }
  return organizations[0] ?? null;
}

export async function assertInvitedUser(
  user: { email: string; emailVerified?: boolean },
  invitationId: string | undefined,
  database: Database = db,
) {
  if (!user.emailVerified && !invitationId) {
    throw new Error("Open your invitation link to create an account.");
  }
  const workspace = await getInstallation(database);
  if (workspace) {
    const [invite] = await database
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, workspace.id),
          eq(sql`lower(${invitation.email})`, user.email.toLowerCase()),
          invitationId ? eq(invitation.id, invitationId) : undefined,
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (invite) return;
  }
  throw new Error("Contact your administrator for an invitation.");
}

export async function setupWorkspace(
  input: z.infer<typeof SetupWorkspaceSchema>,
  database: Database = db,
) {
  const data = SetupWorkspaceSchema.parse(input);
  const password = await hashPassword(data.password);
  return database.transaction(async (tx) => {
    // One installation-wide lock, shared by concurrent setup requests and replicas.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1936028277, 1)`);
    const [existing] = await tx
      .select({ id: organization.id })
      .from(organization)
      .limit(1);
    if (existing)
      throw new InstallationSetupError(
        "This installation is already configured.",
      );
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const now = new Date();
    await tx.insert(user).values({
      id: userId,
      name: data.name,
      email: data.email,
      emailVerified: false,
    });
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password,
    });
    await tx.insert(organization).values({
      id: organizationId,
      name: data.workspaceName,
      slug: "workspace",
      createdAt: now,
    });
    await tx.insert(member).values({
      id: crypto.randomUUID(),
      userId,
      organizationId,
      role: "owner",
      createdAt: now,
    });
    return { organizationId };
  });
}

export async function assertWorkspaceOwnershipTransferred(
  userId: string,
  database: Database = db,
) {
  const memberships = await database
    .select()
    .from(member)
    .where(eq(member.userId, userId));
  for (const membership of memberships) {
    if (!isOrganizationOwner(membership.role)) continue;
    const peers = await database
      .select({ role: member.role })
      .from(member)
      .where(eq(member.organizationId, membership.organizationId));
    if (peers.filter((peer) => isOrganizationOwner(peer.role)).length <= 1)
      throw new Error(
        "Transfer workspace ownership before deleting your account.",
      );
  }
}
