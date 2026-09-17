import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq, ne } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db/client";
import { invitation, member, organization } from "@/db/schema";
import { auth } from "@/lib/auth.server";
import { billing } from "@/lib/billing/server";
import {
  lockHobbyOrganizationOwnership,
  readOrgEntitlement,
  userOwnsHobbyOrganization,
} from "@/lib/billing-data.server";
import { isOrganizationAdmin } from "@/lib/organization-role";
import { requireOrgMiddleware } from "@/lib/serverFn";

export class NotBillingAdminError extends Error {
  name = "NotBillingAdminError";
}

class HobbyDowngradeUnavailableError extends Error {
  name = "HobbyDowngradeUnavailableError";
}

const billingAdminMiddleware = createMiddleware()
  .middleware([requireOrgMiddleware])
  .server(async ({ next, context: { session } }) => {
    const { role } = await auth.api.getActiveMemberRole({
      headers: getRequestHeaders(),
    });
    if (!isOrganizationAdmin(role)) {
      throw new NotBillingAdminError("Only org admins can manage billing");
    }

    return next({
      context: { orgId: session.session.activeOrganizationId },
    });
  });

const createBillingAdminServerFn = createServerFn().middleware([
  billingAdminMiddleware,
]);

export const ensureOrgBillingAdmin = createBillingAdminServerFn({
  method: "GET",
}).handler(async () => ({ ok: true }));

export const getOrgEntitlement = createBillingAdminServerFn({
  method: "GET",
}).handler(async ({ context: { orgId } }) => readOrgEntitlement(orgId));

export const getActiveOrgAppAccess = createServerFn()
  .middleware([requireOrgMiddleware])
  .handler(async ({ context: { session } }) =>
    readOrgEntitlement(session.session.activeOrganizationId),
  );

export const getSuspendedOrgRecovery = createServerFn()
  .middleware([requireOrgMiddleware])
  .handler(async ({ context: { session } }) => {
    const { role } = await auth.api.getActiveMemberRole({
      headers: getRequestHeaders(),
    });
    const roles = role?.split(",") ?? [];
    const isOwner = roles.includes("owner");
    const isAdmin = isOwner || roles.includes("admin");
    const orgId = session.session.activeOrganizationId;

    return {
      entitlement: await readOrgEntitlement(orgId),
      canManageBilling: isAdmin,
      canDowngrade: isOwner,
      ownsAnotherHobby: isOwner
        ? await userOwnsHobbyOrganization(session.user.id, orgId)
        : false,
    };
  });

export const startOrgCheckout = createBillingAdminServerFn({
  method: "POST",
})
  .inputValidator(z.object({ slug: z.literal("pro") }))
  .handler(async ({ context: { session, orgId } }) => {
    return billing.startUpgradeCheckout(orgId, session.user.id);
  });

export const getOrgPortalUrl = createBillingAdminServerFn({
  method: "POST",
}).handler(({ context: { orgId, session } }) =>
  billing.openPortal(orgId, session.user.id),
);
export const getOrgBillingSettings = createBillingAdminServerFn({
  method: "GET",
}).handler(({ context: { orgId, session } }) =>
  billing.getSettings(orgId, session.user.id),
);
export const changeOrgBillingOwner = createBillingAdminServerFn({
  method: "POST",
})
  .inputValidator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data, context: { orgId, session } }) => {
    await billing.changeOwner(orgId, session.user.id, data.userId);
    return { status: "completed" as const };
  });
export const confirmOrgCheckout = createBillingAdminServerFn({ method: "POST" })
  .inputValidator(z.object({ checkoutId: z.string().min(1) }))
  .handler(({ data, context: { orgId, session } }) =>
    billing.confirmUpgradeCheckout(orgId, session.user.id, data.checkoutId),
  );

export const downgradeSuspendedOrganization = createServerFn({ method: "POST" })
  .middleware([requireOrgMiddleware])
  .handler(async ({ context: { session } }) => {
    const orgId = session.session.activeOrganizationId;
    const { role } = await auth.api.getActiveMemberRole({
      headers: getRequestHeaders(),
    });
    if (!role?.split(",").includes("owner")) {
      throw new HobbyDowngradeUnavailableError(
        "Only an Owner can downgrade this organization.",
      );
    }
    if ((await readOrgEntitlement(orgId)).appState !== "suspended") {
      throw new HobbyDowngradeUnavailableError(
        "Only a suspended Pro organization can be downgraded.",
      );
    }
    const result = await billing.downgrade(
      orgId,
      session.user.id,
      (revokeBillingAccess) =>
        db.transaction(async (tx) => {
          // Serialize the application-level one-Hobby-per-Owner check before
          // revoking a subscription that may not be convertible to Hobby.
          await lockHobbyOrganizationOwnership(tx, session.user.id);
          if (await userOwnsHobbyOrganization(session.user.id, orgId)) {
            throw new HobbyDowngradeUnavailableError(
              "You already own a Hobby organization.",
            );
          }

          await revokeBillingAccess();

          const removedMembers = await tx
            .delete(member)
            .where(
              and(
                eq(member.organizationId, orgId),
                ne(member.userId, session.user.id),
              ),
            )
            .returning({ id: member.id });
          const canceledInvitations = await tx
            .update(invitation)
            .set({ status: "canceled" })
            .where(
              and(
                eq(invitation.organizationId, orgId),
                eq(invitation.status, "pending"),
              ),
            )
            .returning({ id: invitation.id });
          await tx
            .update(organization)
            .set({ plan: "hobby" })
            .where(eq(organization.id, orgId));
          return {
            removedMembers: removedMembers.length,
            canceledInvitations: canceledInvitations.length,
          };
        }),
    );

    return { status: "completed" as const, ...result };
  });
