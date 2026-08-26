import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema";

// This module has no dependency on auth.server.ts or serverFn.ts on
// purpose: auth.server.ts spreads the hooks at the end of this file into
// the organization plugin, and a guard file that itself imported back into
// auth.server.ts (through data/service-accounts.ts, which imports
// serverFn.ts, which imports auth.server.ts) would create an import
// cycle that breaks server startup.

// Every guard below asks the same question of the user row, because the
// flag is what tells a machine principal from a person.
async function isServiceAccountUser(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isServiceAccount: user.isServiceAccount })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.isServiceAccount === true;
}

// An invitation names an address, not a user id, so this guard resolves the
// address to a user row first. Addresses are stored lowercase, so a
// lowercased equality catches every spelling of one.
async function isServiceAccountEmail(email: string): Promise<boolean> {
  const [row] = await db
    .select({ isServiceAccount: user.isServiceAccount })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .limit(1);
  return row?.isServiceAccount === true;
}

// Wired into the organization plugin's `beforeUpdateMemberRole` hook
// (`serviceAccountOrganizationHooks`, below), so a promotion to owner is
// refused there too, not only on the create path. The members table's role
// selector already hides Owner for a service-account row, but the UI is not
// a security boundary.
export async function assertRoleChangeAllowed(
  memberUserId: string,
  newRole: string,
): Promise<void> {
  if (newRole !== "owner") return;
  if (await isServiceAccountUser(memberUserId)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "A service account cannot hold the owner role. Promote by hand in the database if a real case appears.",
    });
  }
}

// Wired into the organization plugin's `beforeCreateOrganization` hook
// (`serviceAccountOrganizationHooks`, below). Two reasons it has to sit
// there and not later:
//
// `/organization/create` writes the organization row before it adds the
// creator, so a refusal at `beforeAddMember` leaves an organization behind
// that has no member. `/organization/delete` needs a membership, so nothing
// can ever remove that row, and a caller holding a valid token could repeat
// the call to grow the table without bound.
//
// It is also what holds a service account to one membership. The addition
// guard below only refuses because the creator role is owner, so a
// different `creatorRole` in the plugin configuration would let a second
// membership through, and the organization the token resolves to would
// start depending on row order.
//
// The plugin's `allowUserToCreateOrganization` option cannot do this job:
// it is handed the session user object, which for a service-account
// session is built by the plugin and carries no flag. Only the user row
// answers the question.
export async function assertOrganizationCreatorAllowed(
  userId: string,
): Promise<void> {
  if (await isServiceAccountUser(userId)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "A service account cannot create an organization. It acts in the organization that created it.",
    });
  }
}

// Wired into the organization plugin's `beforeAddMember` hook
// (`serviceAccountOrganizationHooks`, below). It fires for the creator's
// own member row on `/organization/create` and for any `auth.api.addMember`
// call, which writes a member row directly with no role check and no
// invitation in the way.
//
// It refuses the addition whatever the role, not only owner. A service
// account's own membership is written by `createServiceAccount`, never
// here, so nothing legitimate reaches this hook with one. Refusing on the
// role alone would hold only while the creator role stays `owner`: a
// service account with a second membership has no defined organization,
// because the membership is what says which organization it acts in.
export async function assertMemberAdditionAllowed(
  memberUserId: string,
): Promise<void> {
  if (await isServiceAccountUser(memberUserId)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "A service account cannot be added to an organization. It gets its membership when it is created, and a second one would leave it with no organization to act in.",
    });
  }
}

// Wired into the organization plugin's `beforeCreateInvitation` hook
// (`serviceAccountOrganizationHooks`, below). `/organization/invite-member`
// is an ordinary client-callable endpoint, so an owner of any organization
// could otherwise invite a service account to any role, and
// `acceptInvitation` writes the member row with no role hook in the way.
export async function assertInvitationRecipientAllowed(
  email: string,
): Promise<void> {
  if (await isServiceAccountEmail(email)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "Cannot invite a service account. Create one from the Service accounts section instead.",
    });
  }
}

// Wired into the organization plugin's `beforeAcceptInvitation` hook
// (`serviceAccountOrganizationHooks`, below). The create guard above stops
// new invitations; this stops any invitation that already exists, whichever
// path wrote it.
export async function assertInvitationAcceptorAllowed(
  userId: string,
): Promise<void> {
  if (await isServiceAccountUser(userId)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "A service account cannot accept an invitation. Its membership comes from the service account itself.",
    });
  }
}

// Wired into the organization plugin's `beforeRemoveMember` hook
// (`serviceAccountOrganizationHooks`, below). Removing the member row
// through that path, rather than through `deleteServiceAccount`, would
// leave the account, its secrets, and its user row behind with no
// membership to act through.
export async function assertMemberRemovalAllowed(
  memberUserId: string,
): Promise<void> {
  if (await isServiceAccountUser(memberUserId)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "Removing a service account's membership would orphan its secrets and tokens. Delete the service account instead.",
    });
  }
}

// The organization plugin's wiring lives here, not inline in auth.server.ts,
// so that one object is both what runs in production and what
// service-account-contract.test.ts drives a real better-auth instance with.
// Unwiring a guard therefore breaks that test, which is the only thing that
// would notice a better-auth release renaming a hook or moving where it
// fires.
export const serviceAccountOrganizationHooks = {
  beforeCreateOrganization: async ({
    user: creator,
  }: {
    user: { id: string };
  }) => {
    await assertOrganizationCreatorAllowed(creator.id);
  },
  beforeAddMember: async ({
    member: target,
  }: {
    member: { userId: string };
  }) => {
    await assertMemberAdditionAllowed(target.userId);
  },
  beforeCreateInvitation: async ({
    invitation,
  }: {
    invitation: { email: string };
  }) => {
    await assertInvitationRecipientAllowed(invitation.email);
  },
  beforeAcceptInvitation: async ({
    user: invitee,
  }: {
    user: { id: string };
  }) => {
    await assertInvitationAcceptorAllowed(invitee.id);
  },
  beforeUpdateMemberRole: async ({
    member: target,
    newRole,
  }: {
    member: { userId: string };
    newRole: string;
  }) => {
    await assertRoleChangeAllowed(target.userId, newRole);
  },
  beforeRemoveMember: async ({
    member: target,
  }: {
    member: { userId: string };
  }) => {
    await assertMemberRemovalAllowed(target.userId);
  },
};
