import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { ProvisionOrganizationBillingInputSchema } from "@/common/organization-name";
import { db } from "@/db/client";
import { organization } from "@/db/schema";
import { env } from "@/env";
import { auth } from "@/lib/auth.server";
import { readOrgEntitlement } from "@/lib/billing-data.server";
import { isOrganizationAdmin } from "@/lib/organization-role";
import {
  assertPolarBillingEmailAvailable,
  createPolarCustomer,
  hasPolarCustomerForOrg,
  polarClient,
} from "@/lib/polar.server";
import { requireOrgMiddleware } from "@/lib/serverFn";

export class NotBillingAdminError extends Error {
  name = "NotBillingAdminError";
}

class BillingCustomerNotFoundError extends Error {
  name = "BillingCustomerNotFoundError";
}

async function getOrganizationName(orgId: string) {
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!org) throw new Error("Organization not found");
  return org.name;
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

export const getOrgBillingCustomerStatus = createBillingAdminServerFn({
  method: "GET",
}).handler(async ({ context: { orgId } }) => ({
  configured: await hasPolarCustomerForOrg(orgId),
}));

export const provisionOrgBillingCustomer = createBillingAdminServerFn({
  method: "POST",
})
  .inputValidator(ProvisionOrganizationBillingInputSchema)
  .handler(async ({ data, context: { orgId } }) => {
    if (await hasPolarCustomerForOrg(orgId)) {
      return { configured: true };
    }

    await assertPolarBillingEmailAvailable(data.billingEmail);
    await createPolarCustomer({
      externalId: orgId,
      email: data.billingEmail,
      name: await getOrganizationName(orgId),
    });

    return { configured: true };
  });

export const startOrgCheckout = createBillingAdminServerFn({
  method: "POST",
})
  .inputValidator(z.object({ slug: z.literal("pro") }))
  .handler(async ({ context: { session, orgId } }) => {
    if (!(await hasPolarCustomerForOrg(orgId))) {
      throw new BillingCustomerNotFoundError(
        "Set up billing details before starting checkout.",
      );
    }

    const successUrl = new URL(
      "/checkout/success?checkout_id={CHECKOUT_ID}",
      env.BETTER_AUTH_URL,
    ).toString();

    const checkout = await polarClient.checkouts.create({
      products: [env.POLAR_PRO_PRODUCT_ID],
      externalCustomerId: orgId,
      successUrl,
      metadata: { orgId, userId: session.user.id },
    });

    return { url: checkout.url };
  });

export const getOrgPortalUrl = createBillingAdminServerFn({
  method: "POST",
}).handler(async ({ context: { orgId } }) => {
  try {
    await polarClient.customers.getExternal({ externalId: orgId });
  } catch (error) {
    if (!(error instanceof ResourceNotFound)) throw error;
    return { status: "customer_missing" as const };
  }

  const result = await polarClient.customerSessions.create({
    externalCustomerId: orgId,
  });
  return { status: "ready" as const, url: result.customerPortalUrl };
});
