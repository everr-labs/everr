import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/db/client";
import {
  member,
  serviceAccount,
  serviceAccountSecret,
  serviceAccountToken,
  user,
} from "@/db/schema";
import { auth } from "@/lib/auth.server";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { generateSecret } from "@/lib/service-account-credentials";

export const SERVICE_ACCOUNT_ROLES = ["admin", "member"] as const;
export type ServiceAccountRole = (typeof SERVICE_ACCOUNT_ROLES)[number];

// RFC 2606 reserves .invalid, so an address on this domain can never receive
// mail.
const SERVICE_ACCOUNT_EMAIL_DOMAIN = "svc.everr.invalid";

// Filler for a required column, not an identifier. `user.email` is NOT NULL
// and unique in Better Auth's schema, so a synthetic user still needs an
// address. What tells a service account apart is `user.isServiceAccount`.
export function serviceAccountEmail(id: string): string {
  return `${id}@${SERVICE_ACCOUNT_EMAIL_DOMAIN}`;
}

function isServiceAccountRole(value: string): value is ServiceAccountRole {
  return (SERVICE_ACCOUNT_ROLES as readonly string[]).includes(value);
}

// A service account is a standing credential that can act as an admin- or
// member-level principal, so creating, listing, or managing one must stay
// restricted to the org's own admins and owner. Called first in every
// handler below, the same shape as `ensureOrgAdmin` in
// `data/alerts/server.ts`.
async function ensureServiceAccountAdmin(): Promise<void> {
  const { role } = await auth.api.getActiveMemberRole({
    headers: getRequestHeaders(),
  });
  if (role !== "admin" && role !== "owner") {
    throw new Error("Only organization admins can manage service accounts");
  }
}

// The tenant-isolation check shared by every handler that acts on one
// existing service account: confirm it exists and belongs to the caller's
// organization before doing anything else with it. The membership is what
// says which organization it belongs to, so the join is the check.
async function requireServiceAccountInOrg(
  organizationId: string,
  serviceAccountId: string,
): Promise<{ userId: string }> {
  const [account] = await db
    .select({ userId: serviceAccount.userId })
    .from(serviceAccount)
    .innerJoin(
      member,
      and(
        eq(member.userId, serviceAccount.userId),
        eq(member.organizationId, organizationId),
      ),
    )
    .where(eq(serviceAccount.id, serviceAccountId))
    .limit(1);

  if (!account) {
    throw new Error("Service account not found");
  }

  return account;
}

export type ServiceAccountSecretSummary = {
  id: string;
  start: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type ServiceAccountSummary = {
  id: string;
  // The synthetic user this account acts as. The members table matches on it
  // to tell which of its rows are machines.
  userId: string;
  name: string;
  role: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  createdByUserId: string | null;
  createdByName: string | null;
  secrets: ServiceAccountSecretSummary[];
};

const CreateServiceAccountInput = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    role: z.string().trim().min(1, "Role is required"),
  })
  .strict();

export const createServiceAccount = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CreateServiceAccountInput)
  .handler(async ({ data, context: { session } }) => {
    await ensureServiceAccountAdmin();

    // Owner controls billing and organization deletion, which must not sit
    // behind an unattended credential.
    if (!isServiceAccountRole(data.role)) {
      throw new Error(
        `Unsupported role "${data.role}". Choose one of: ${SERVICE_ACCOUNT_ROLES.join(", ")}.`,
      );
    }

    const organizationId = session.session.activeOrganizationId;
    const authContext = await auth.$context;
    const serviceAccountId = crypto.randomUUID();

    // "Is this a machine" has two representations: `user.isServiceAccount`,
    // which the guards read, and the existence of a `service_account` row,
    // which the data layer reads. Only one direction would matter if they
    // drifted: a `service_account` row over a user that is not flagged,
    // because then no guard fires for a real service account. It cannot
    // happen. This is the only statement in the app that writes the flag and
    // the only one that writes a `service_account` row, the flag is written
    // first and the row second, `service_account.user_id` cascades on user
    // delete so the row can never outlive its user, and Better Auth refuses
    // the field on every client-facing write (`input: false`, and on update
    // it drops the field rather than defaulting it). The other direction, a
    // flagged user with no `service_account` row, is what the compensating
    // delete below leaves if it fails, and it is harmless: the guards still
    // refuse and every org-scoped query joins through `service_account`.
    //
    // No password is linked here, so no `account` row is created. Better
    // Auth resolves password sign-in through `account`; with none, there is
    // nothing to sign in with. That absence is the guard.
    const createdUser = await authContext.internalAdapter.createUser(
      {
        name: data.name,
        email: serviceAccountEmail(serviceAccountId),
        emailVerified: true,
        // The flag every guard reads. This is the only path that sets it:
        // Better Auth refuses it on every client-facing write.
        isServiceAccount: true,
      },
      { method: "admin" },
    );

    try {
      const secret = generateSecret();
      const secretId = crypto.randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(member).values({
          id: crypto.randomUUID(),
          organizationId,
          userId: createdUser.id,
          role: data.role,
          createdAt: new Date(),
        });

        await tx.insert(serviceAccount).values({
          id: serviceAccountId,
          userId: createdUser.id,
          createdByUserId: session.user.id,
        });

        await tx.insert(serviceAccountSecret).values({
          id: secretId,
          serviceAccountId,
          hash: secret.hash,
          start: secret.start,
        });
      });

      return {
        id: serviceAccountId,
        name: data.name,
        role: data.role,
        secretId,
        secret: secret.value,
        start: secret.start,
      };
    } catch (error) {
      // The user row lives outside this transaction (Better Auth's internal
      // adapter holds its own database handle), so a failure past this point
      // would otherwise leave a user with no membership and no service
      // account behind it. Best-effort cleanup; the original error still wins.
      await authContext.internalAdapter
        .deleteUser(createdUser.id)
        .catch(() => {});
      throw error;
    }
  });

const RotateServiceAccountSecretInput = z
  .object({ serviceAccountId: z.string().trim().min(1) })
  .strict();

export const rotateServiceAccountSecret = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(RotateServiceAccountSecretInput)
  .handler(async ({ data, context: { session } }) => {
    await ensureServiceAccountAdmin();

    const organizationId = session.session.activeOrganizationId;
    await requireServiceAccountInOrg(organizationId, data.serviceAccountId);

    // The previous secret stays live: rotation only adds a new one. A
    // caller revokes the old secret explicitly once traffic has moved over.
    const secret = generateSecret();
    const secretId = crypto.randomUUID();
    await db.insert(serviceAccountSecret).values({
      id: secretId,
      serviceAccountId: data.serviceAccountId,
      hash: secret.hash,
      start: secret.start,
    });

    return { id: secretId, secret: secret.value, start: secret.start };
  });

const RevokeServiceAccountSecretInput = z
  .object({ secretId: z.string().trim().min(1) })
  .strict();

export const revokeServiceAccountSecret = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(RevokeServiceAccountSecretInput)
  .handler(async ({ data, context: { session } }) => {
    await ensureServiceAccountAdmin();

    const organizationId = session.session.activeOrganizationId;

    const [secret] = await db
      .select({
        id: serviceAccountSecret.id,
        serviceAccountId: serviceAccountSecret.serviceAccountId,
      })
      .from(serviceAccountSecret)
      .where(eq(serviceAccountSecret.id, data.secretId))
      .limit(1);

    if (!secret) {
      throw new Error("Service account secret not found");
    }

    await requireServiceAccountInOrg(organizationId, secret.serviceAccountId);

    // A revoked secret takes its tokens with it, so revocation is immediate
    // rather than waiting for each token to expire on its own.
    await db.transaction(async (tx) => {
      await tx
        .delete(serviceAccountToken)
        .where(eq(serviceAccountToken.serviceAccountSecretId, data.secretId));

      await tx
        .update(serviceAccountSecret)
        .set({ revokedAt: new Date() })
        .where(eq(serviceAccountSecret.id, data.secretId));
    });

    return { id: data.secretId };
  });

const DeleteServiceAccountInput = z
  .object({ serviceAccountId: z.string().trim().min(1) })
  .strict();

export const deleteServiceAccount = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(DeleteServiceAccountInput)
  .handler(async ({ data, context: { session } }) => {
    await ensureServiceAccountAdmin();

    const organizationId = session.session.activeOrganizationId;
    const account = await requireServiceAccountInOrg(
      organizationId,
      data.serviceAccountId,
    );

    // Deleting the user row cascades to its member row, its secrets, and
    // their tokens (Task 2's foreign keys). It has no account row to cascade.
    await db.delete(user).where(eq(user.id, account.userId));

    return { id: data.serviceAccountId };
  });

export const listServiceAccounts = createAuthenticatedServerFn({
  method: "GET",
}).handler(
  async ({ context: { session } }): Promise<ServiceAccountSummary[]> => {
    await ensureServiceAccountAdmin();

    const organizationId = session.session.activeOrganizationId;
    const creator = alias(user, "creator");

    // The membership scopes both queries to the caller's organization, the
    // same way it does for a person.
    const accounts = await db
      .select({
        id: serviceAccount.id,
        userId: serviceAccount.userId,
        name: user.name,
        role: member.role,
        createdAt: serviceAccount.createdAt,
        lastUsedAt: serviceAccount.lastUsedAt,
        createdByUserId: serviceAccount.createdByUserId,
        createdByName: creator.name,
      })
      .from(serviceAccount)
      .innerJoin(user, eq(user.id, serviceAccount.userId))
      .innerJoin(
        member,
        and(
          eq(member.userId, serviceAccount.userId),
          eq(member.organizationId, organizationId),
        ),
      )
      // Left join: the creator's own user row can be gone (`onDelete: "set
      // null"` on `createdByUserId`), and the account itself must still list.
      .leftJoin(creator, eq(creator.id, serviceAccount.createdByUserId));

    const secrets = await db
      .select({
        id: serviceAccountSecret.id,
        serviceAccountId: serviceAccountSecret.serviceAccountId,
        start: serviceAccountSecret.start,
        createdAt: serviceAccountSecret.createdAt,
        lastUsedAt: serviceAccountSecret.lastUsedAt,
        revokedAt: serviceAccountSecret.revokedAt,
      })
      .from(serviceAccountSecret)
      .innerJoin(
        serviceAccount,
        eq(serviceAccount.id, serviceAccountSecret.serviceAccountId),
      )
      .innerJoin(
        member,
        and(
          eq(member.userId, serviceAccount.userId),
          eq(member.organizationId, organizationId),
        ),
      );

    const secretsByAccountId = new Map<string, ServiceAccountSecretSummary[]>();
    for (const { serviceAccountId, ...secret } of secrets) {
      const list = secretsByAccountId.get(serviceAccountId) ?? [];
      list.push(secret);
      secretsByAccountId.set(serviceAccountId, list);
    }

    return accounts.map((account) => ({
      ...account,
      secrets: secretsByAccountId.get(account.id) ?? [],
    }));
  },
);
