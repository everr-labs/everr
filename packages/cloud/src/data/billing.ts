import { auth } from "@everr/app/identity/server";
import { createOrganizationAdminServerFn, requireOrgMiddleware } from "@everr/app/lib/serverFn";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import * as z from "zod";
import { billing } from "../billing/server";
import { readOrgEntitlement, userOwnsHobbyOrganization } from "../billing-data.server";
import { organizationCommands } from "../organizations/commands.server";

export const getOrgEntitlement = createOrganizationAdminServerFn({
  method: "GET",
}).handler(async ({ context: { orgId } }) => readOrgEntitlement(orgId));

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
      ownsAnotherHobby: isOwner ? await userOwnsHobbyOrganization(session.user.id, orgId) : false,
    };
  });

export const startOrgCheckout = createOrganizationAdminServerFn({
  method: "POST",
})
  .inputValidator(z.object({ slug: z.literal("pro") }))
  .handler(async ({ context: { session, orgId } }) => {
    return billing.startUpgradeCheckout(orgId, session.user.id);
  });

export const getOrgPortalUrl = createOrganizationAdminServerFn({
  method: "POST",
}).handler(({ context: { orgId, session } }) => billing.openPortal(orgId, session.user.id));
export const getOrgBillingSettings = createOrganizationAdminServerFn({
  method: "GET",
}).handler(({ context: { orgId, session } }) => billing.getSettings(orgId, session.user.id));
export const changeOrgBillingOwner = createOrganizationAdminServerFn({
  method: "POST",
})
  .inputValidator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data, context: { orgId, session } }) => {
    await billing.changeOwner(orgId, session.user.id, data.userId);
    return { status: "completed" as const };
  });
export const confirmOrgCheckout = createOrganizationAdminServerFn({
  method: "POST",
})
  .inputValidator(z.object({ checkoutId: z.string().min(1) }))
  .handler(({ data, context: { orgId, session } }) =>
    billing.confirmUpgradeCheckout(orgId, session.user.id, data.checkoutId),
  );

export const downgradeSuspendedOrganization = createServerFn({ method: "POST" })
  .middleware([requireOrgMiddleware])
  .handler(async ({ context: { session } }) => ({
    status: "completed" as const,
    ...(await organizationCommands.downgradeToHobby({
      organizationId: session.session.activeOrganizationId,
      actorId: session.user.id,
    })),
  }));
