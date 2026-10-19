import { APIError } from "better-auth/api";
import { eq, inArray } from "drizzle-orm";
import type { IdentityPolicy } from "#app/composition/identity-policy.ts";
import type { IdentityProvider } from "#app/composition/identity-provider.ts";
import type { Database } from "#app/db/database.ts";
import { member, organization } from "#app/db/schema/index.ts";
import { isOrganizationOwner } from "#app/lib/organization-role.ts";
import { enforceIdentityPolicy } from "./enforce-policy";

interface AccountDependencies {
  database: Database;
  api: {
    getSession(input: {
      headers: Headers;
      query: { disableCookieCache: true };
    }): Promise<{
      user: { id: string };
      session: { activeOrganizationId?: string | null; createdAt: Date };
    } | null>;
    deleteOrganization(input: {
      headers: Headers;
      body: { organizationId: string };
    }): Promise<unknown>;
    deleteUser(input: {
      headers: Headers;
      body: Record<string, never>;
    }): Promise<unknown>;
  };
  policy: Pick<
    IdentityPolicy,
    "assertAccountDeletionAllowed" | "beforeUserDelete"
  >;
  withIdentityRequest: IdentityProvider["withIdentityRequest"];
  lockAccountDeletion: IdentityProvider["lockAccountDeletion"];
  sessionFreshAge(): Promise<number>;
}

/** Shared account authorization and provider sequencing for every deletion entry point. */
export function createAccountLifecycle({
  database,
  api,
  policy,
  withIdentityRequest,
  lockAccountDeletion,
  sessionFreshAge,
}: AccountDependencies) {
  async function readOrganizations(userId: string) {
    const memberships = await database
      .select({ id: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId));
    const ids = memberships.map(({ id }) => id);
    await lockAccountDeletion(ids);
    if (!ids.length) return [];
    const rows = await database
      .select({
        id: organization.id,
        name: organization.name,
        userId: member.userId,
        role: member.role,
      })
      .from(organization)
      .innerJoin(member, eq(member.organizationId, organization.id))
      .where(inArray(organization.id, ids));
    return ids
      .map((id) => {
        const peers = rows.filter((row) => row.id === id);
        const membership = peers.find((row) => row.userId === userId);
        return membership
          ? {
              id,
              name: membership.name,
              isOwner: isOrganizationOwner(membership.role),
              ownerCount: peers.filter((peer) => isOrganizationOwner(peer.role))
                .length,
            }
          : undefined;
      })
      .filter((value) => value !== undefined);
  }

  async function authorize(
    userId: string,
    deletingOrganizationId?: string | null,
  ) {
    const organizations = await readOrganizations(userId);
    await enforceIdentityPolicy(() =>
      policy.assertAccountDeletionAllowed(
        organizations.filter(({ isOwner }) => isOwner),
      ),
    );
    const soleOwned = organizations.filter(
      ({ id, isOwner, ownerCount }) =>
        isOwner && ownerCount === 1 && id !== deletingOrganizationId,
    );
    if (soleOwned.length)
      throw new APIError("FORBIDDEN", {
        message: `Transfer ownership before deleting your account. You are the only owner of: ${soleOwned.map(({ name }) => name).join(", ")}.`,
      });
    return organizations;
  }

  return {
    /** Runs before the provider removes credentials, sessions, or the user. */
    async beforeDeleteUser(userId: string): Promise<void> {
      await authorize(userId);
      await enforceIdentityPolicy(() => policy.beforeUserDelete(userId));
    },
    async deleteAccount({
      headers,
      deleteOrganization = false,
    }: {
      headers: Headers;
      deleteOrganization?: boolean;
    }): Promise<void> {
      await withIdentityRequest(async () => {
        const session = await api.getSession({
          headers,
          query: { disableCookieCache: true },
        });
        if (!session)
          throw new APIError("UNAUTHORIZED", { message: "Unauthenticated" });
        const freshAge = await sessionFreshAge();
        if (
          freshAge !== 0 &&
          Date.now() - new Date(session.session.createdAt).getTime() >=
            freshAge * 1000
        )
          throw new APIError("BAD_REQUEST", {
            message: "Sign in again before deleting your account.",
          });
        const activeOrganizationId = session.session.activeOrganizationId;
        const organizations = await authorize(
          session.user.id,
          deleteOrganization ? activeOrganizationId : undefined,
        );
        if (deleteOrganization) {
          if (!activeOrganizationId)
            throw new APIError("BAD_REQUEST", {
              message:
                "Select an organization before deleting it with your account.",
            });
          if (
            !organizations.find(({ id }) => id === activeOrganizationId)
              ?.isOwner
          )
            throw new APIError("FORBIDDEN", {
              message:
                "Only organization owners can delete the organization while deleting their account.",
            });
          await api.deleteOrganization({
            headers,
            body: { organizationId: activeOrganizationId },
          });
        }
        try {
          await api.deleteUser({ headers, body: {} });
        } catch (cause) {
          if (!deleteOrganization) throw cause;
          // Provider operations commit separately, so the organization cannot be restored here.
          throw new Error(
            "The organization was deleted, but your account could not be deleted. Please try again.",
            { cause },
          );
        }
      });
    },
  };
}
