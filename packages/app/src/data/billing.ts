import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db/client";
import { organization } from "@/db/schema";
import { env } from "@/env";
import { auth } from "@/lib/auth.server";
import { readOrgEntitlement } from "@/lib/billing-data.server";
import { ensurePolarCustomerForOrg, polarClient } from "@/lib/polar.server";
import {
  createAuthenticatedServerFn,
  requireOrgMiddleware,
} from "@/lib/serverFn";

export class NotBillingAdminError extends Error {
  // fallow-ignore-next-line unused-class-member
  name = "NotBillingAdminError";
}

async function ensureCustomerForOrg(orgId: string, fallbackEmail: string) {
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!org) throw new Error("Organization not found");
  await ensurePolarCustomerForOrg({
    orgId,
    orgName: org.name,
    fallbackEmail,
  });
}

const billingAdminMiddleware = createMiddleware()
  .middleware([requireOrgMiddleware])
  .server(async ({ next, context: { session } }) => {
    const { role } = await auth.api.getActiveMemberRole({
      headers: getRequestHeaders(),
    });
    if (role !== "admin" && role !== "owner") {
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

export const getOrgEntitlement = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) =>
  readOrgEntitlement(session.session.activeOrganizationId),
);

export const startOrgCheckout = createBillingAdminServerFn({
  method: "POST",
})
  .inputValidator(z.object({ slug: z.literal("pro") }))
  .handler(async ({ context: { session, orgId } }) => {
    await ensureCustomerForOrg(orgId, session.user.email);

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
}).handler(async ({ context: { session, orgId } }) => {
  await ensureCustomerForOrg(orgId, session.user.email);
  const result = await polarClient.customerSessions.create({
    externalCustomerId: orgId,
  });
  return { url: result.customerPortalUrl };
});
