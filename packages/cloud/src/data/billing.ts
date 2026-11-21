import { auth } from "@everr/app/identity/server";
// Everything here stays available while the organization is suspended: it is
// how the subscription gets restored or the organization downgraded.
import {
  createOrganizationAdminAllowingSuspendedServerFn,
  requireOrgAllowingSuspendedMiddleware,
} from "@everr/app/lib/serverFn";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import * as z from "zod";
import { billing } from "../billing/server";
import { readOrgEntitlement, userOwnsHobbyOrganization } from "../billing-data.server";
import { organizationCommands } from "../organizations/commands.server";

export const getOrgEntitlement = createOrganizationAdminAllowingSuspendedServerFn({
  method: "GET",
}).handler(async ({ context: { orgId } }) => readOrgEntitlement(orgId));

export const getSuspendedOrgRecovery = createServerFn()
  .middleware([requireOrgAllowingSuspendedMiddleware])
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

export const startOrgCheckout = createOrganizationAdminAllowingSuspendedServerFn({
  method: "POST",
})
  .validator(z.object({ slug: z.literal("pro") }))
  .handler(async ({ context: { session, orgId } }) => {
    return billing.startUpgradeCheckout(orgId, session.user.id);
  });

export const getOrgPortalUrl = createOrganizationAdminAllowingSuspendedServerFn({
  method: "POST",
}).handler(({ context: { orgId, session } }) => billing.openPortal(orgId, session.user.id));
export const getOrgBillingSettings = createOrganizationAdminAllowingSuspendedServerFn({
  method: "GET",
}).handler(({ context: { orgId, session } }) => billing.getSettings(orgId, session.user.id));
export const changeOrgBillingOwner = createOrganizationAdminAllowingSuspendedServerFn({
  method: "POST",
})
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data, context: { orgId, session } }) => {
    await billing.changeOwner(orgId, session.user.id, data.userId);
    return { status: "completed" as const };
  });
export const confirmOrgCheckout = createOrganizationAdminAllowingSuspendedServerFn({
  method: "POST",
})
  .validator(z.object({ checkoutId: z.string().min(1) }))
  .handler(({ data, context: { orgId, session } }) =>
    billing.confirmUpgradeCheckout(orgId, session.user.id, data.checkoutId),
  );

export const downgradeSuspendedOrganization = createServerFn({ method: "POST" })
  .middleware([requireOrgAllowingSuspendedMiddleware])
  .handler(async ({ context: { session } }) => ({
    status: "completed" as const,
    ...(await organizationCommands.downgradeToHobby({
      organizationId: session.session.activeOrganizationId,
      actorId: session.user.id,
    })),
  }));
