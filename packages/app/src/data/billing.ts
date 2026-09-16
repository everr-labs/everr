import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq, ne } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db/client";
import { invitation, member, organization, orgSubscription } from "@/db/schema";
import { env } from "@/env";
import { auth } from "@/lib/auth.server";
import {
  assertPolarProductGrantsPlan,
  polarProductIdForPlan,
} from "@/lib/billing-catalog.server";
import {
  lockHobbyOrganizationOwnership,
  readOrgEntitlement,
  setOrganizationPlan,
  upsertOrgSubscription,
  userOwnsHobbyOrganization,
} from "@/lib/billing-data.server";
import { isOrganizationAdmin } from "@/lib/organization-role";
import {
  getPolarCheckoutSubscription,
  getPolarCustomerForOrg,
  polarClient,
} from "@/lib/polar.server";
import {
  ensureOrganizationTeamCustomer,
  ensurePolarBillingMember,
  readBillingPerson,
} from "@/lib/polar-team.server";
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
    const customer = await ensureOrganizationTeamCustomer(orgId);

    const successUrl = new URL(
      "/checkout/success?checkout_id={CHECKOUT_ID}",
      env.BETTER_AUTH_URL,
    ).toString();

    const checkout = await polarClient.checkouts.create({
      products: [polarProductIdForPlan("pro")],
      customerId: customer.id,
      allowTrial: false,
      successUrl,
      metadata: { orgId, userId: session.user.id },
    });

    return { url: checkout.url };
  });

export const getOrgPortalUrl = createBillingAdminServerFn({
  method: "POST",
}).handler(async ({ context: { orgId, session } }) => {
  const customer = await getPolarCustomerForOrg(orgId);
  if (!customer) return { status: "customer_missing" as const };
  const team = await ensureOrganizationTeamCustomer(orgId);
  const billingMember = await ensurePolarBillingMember(
    team.id,
    await readBillingPerson(session.user.id),
    "billing_manager",
    orgId,
  );
  const result = await polarClient.customerSessions.create({
    customerId: team.id,
    memberId: billingMember.id,
  });
  return { status: "ready" as const, url: result.customerPortalUrl };
});

async function revokeOrgSubscriptionForDowngrade(orgId: string) {
  const [storedSubscription] = await db
    .select({ id: orgSubscription.polarSubscriptionId })
    .from(orgSubscription)
    .where(eq(orgSubscription.orgId, orgId))
    .limit(1);
  if (!storedSubscription) return;

  try {
    const subscription = await polarClient.subscriptions.get({
      id: storedSubscription.id,
    });
    if (
      subscription.status !== "canceled" &&
      subscription.status !== "incomplete_expired"
    ) {
      await polarClient.subscriptions.revoke({ id: subscription.id });
    }
  } catch (error) {
    if (!(error instanceof ResourceNotFound)) throw error;
  }
}

export const confirmOrgCheckout = createBillingAdminServerFn({ method: "POST" })
  .inputValidator(z.object({ checkoutId: z.string().min(1) }))
  .handler(async ({ data, context: { orgId } }) => {
    const checkout = await polarClient.checkouts.get({ id: data.checkoutId });
    if (
      checkout.status !== "succeeded" ||
      !checkout.customerId ||
      !checkout.productId
    ) {
      return { status: "pending" as const };
    }
    if (
      checkout.externalCustomerId != null &&
      checkout.externalCustomerId !== orgId
    ) {
      return { status: "billing_conflict" as const };
    }
    const customer = await getPolarCustomerForOrg(orgId);
    if (!customer || checkout.customerId !== customer.id)
      return { status: "billing_conflict" as const };
    assertPolarProductGrantsPlan(checkout.productId, "pro");

    const subscription = await getPolarCheckoutSubscription(checkout);
    if (
      !subscription ||
      subscription.status !== "active" ||
      !subscription.productId
    ) {
      return { status: "pending" as const };
    }
    assertPolarProductGrantsPlan(subscription.productId, "pro");

    await upsertOrgSubscription({
      orgId,
      polarSubscriptionId: subscription.id,
      polarProductId: subscription.productId,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      polarModifiedAt: subscription.modifiedAt ?? subscription.createdAt,
    });
    await setOrganizationPlan(orgId, "pro");
    return { status: "completed" as const };
  });

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
    const result = await db.transaction(async (tx) => {
      // Serialize the application-level one-Hobby-per-Owner check before
      // revoking a subscription that may not be convertible to Hobby.
      await lockHobbyOrganizationOwnership(tx, session.user.id);
      if (await userOwnsHobbyOrganization(session.user.id, orgId)) {
        throw new HobbyDowngradeUnavailableError(
          "You already own a Hobby organization.",
        );
      }

      await revokeOrgSubscriptionForDowngrade(orgId);

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
    });

    return { status: "completed" as const, ...result };
  });
