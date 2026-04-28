import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import * as z from "zod";
import { env } from "@/env";
import { auth } from "@/lib/auth.server";
import { getOrgEntitlement as readOrgEntitlement } from "@/lib/billing-data.server";
import { ensurePolarCustomerForOrg, polarClient } from "@/lib/polar.server";
import {
  createAuthenticatedServerFn,
  requireOrgMiddleware,
} from "@/lib/serverFn";

const SLUG_TO_PRODUCT: Record<string, string | undefined> = {
  pro: env.POLAR_PRO_PRODUCT_ID,
};

const billingAdminMiddleware = createMiddleware()
  .middleware([requireOrgMiddleware])
  .server(async ({ next, context: { session } }) => {
    const orgId = session.session.activeOrganizationId;

    const { role } = await auth.api.getActiveMemberRole({
      headers: getRequestHeaders(),
    });
    if (role !== "admin" && role !== "owner") {
      throw new Error("Only org admins can manage billing");
    }

    const org = await auth.api.getFullOrganization({
      headers: getRequestHeaders(),
      query: { organizationId: orgId },
    });
    if (!org) throw new Error("Organization not found");

    await ensurePolarCustomerForOrg({
      orgId: org.id,
      orgName: org.name,
      fallbackEmail: session.user.email,
    });

    return next({ context: { org } });
  });

const createBillingAdminServerFn = createServerFn().middleware([
  billingAdminMiddleware,
]);

export const getOrgEntitlement = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) =>
  readOrgEntitlement(session.session.activeOrganizationId),
);

export const startOrgCheckout = createBillingAdminServerFn({
  method: "POST",
})
  .inputValidator(z.object({ slug: z.string() }))
  .handler(async ({ context: { session, org }, data }) => {
    const productId = SLUG_TO_PRODUCT[data.slug];
    if (!productId) throw new Error("Unknown product");

    const successUrl = new URL(
      "/checkout/success?checkout_id={CHECKOUT_ID}",
      env.BETTER_AUTH_URL,
    ).toString();

    const checkout = await polarClient.checkouts.create({
      products: [productId],
      externalCustomerId: org.id,
      successUrl,
      metadata: { orgId: org.id, userId: session.user.id },
    });

    return { url: checkout.url };
  });

export const getOrgPortalUrl = createBillingAdminServerFn({
  method: "POST",
}).handler(async ({ context: { org } }) => {
  const result = await polarClient.customerSessions.create({
    externalCustomerId: org.id,
  });
  return { url: result.customerPortalUrl };
});
