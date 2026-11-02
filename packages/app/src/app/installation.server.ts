import { hashPassword } from "better-auth/crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "#app/db/database.ts";
import { account, invitation, member, organization, user } from "#app/db/schema/index.ts";
import type { EventPublisher } from "#app/composition/events.ts";
import {
  membershipChanged,
  organizationChanged,
  userCreated,
  type IdentityEvent,
} from "#app/identity/events.ts";
import { IdentityPolicyError } from "#app/identity/policy-error.ts";

export class InstallationSetupError extends Error {}

export const SetupWorkspaceSchema = z.object({
  workspaceName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(1).max(100),
  email: z.email().transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
});

export async function getInstallation(database: Database) {
  const organizations = await database.select({ id: organization.id }).from(organization).limit(2);
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
  database: Database,
) {
  if (!user.emailVerified && !invitationId) {
    throw new IdentityPolicyError("Open your invitation link to create an account.");
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
  throw new IdentityPolicyError("Contact your administrator for an invitation.");
}

export async function setupWorkspace(
  input: z.infer<typeof SetupWorkspaceSchema>,
  database: Database,
  events: EventPublisher<IdentityEvent> = { async publish() {} },
) {
  const data = SetupWorkspaceSchema.parse(input);
  const password = await hashPassword(data.password);
  const result = await database.transaction(async (tx) => {
    // One installation-wide lock, shared by concurrent setup requests and replicas.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1936028277, 1)`);
    const [existing] = await tx.select({ id: organization.id }).from(organization).limit(1);
    if (existing) throw new InstallationSetupError("This installation is already configured.");
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
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
      id: membershipId,
      userId,
      organizationId,
      role: "owner",
      createdAt: now,
    });
    return { organizationId, userId, membershipId };
  });
  await events.publish(userCreated(result.userId, false));
  await events.publish(organizationChanged("organization.created", result.organizationId));
  await events.publish(
    membershipChanged("membership.added", { id: result.membershipId, ...result }),
  );
  return { organizationId: result.organizationId };
}
