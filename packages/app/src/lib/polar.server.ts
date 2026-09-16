import { Polar } from "@polar-sh/sdk";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import { env } from "@/env";
export const polarClient = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  server: env.POLAR_SERVER,
});

export async function getPolarCheckoutSubscription(checkout: {
  id: string;
  subscriptionId?: string | null;
  customerId?: string | null;
  productId?: string | null;
}) {
  if (!checkout.customerId || !checkout.productId) return null;
  const matches = (subscription: {
    checkoutId?: string | null;
    customerId: string;
    productId: string;
  }) =>
    subscription.checkoutId === checkout.id &&
    subscription.customerId === checkout.customerId &&
    subscription.productId === checkout.productId;
  if (checkout.subscriptionId) {
    const subscription = await polarClient.subscriptions.get({
      id: checkout.subscriptionId,
    });
    return matches(subscription) ? subscription : null;
  }
  const pages = await polarClient.subscriptions.list({
    customerId: checkout.customerId,
    productId: checkout.productId,
    active: true,
    limit: 100,
  });
  for await (const page of pages) {
    const subscription = page.result.items.find(matches);
    if (subscription) return subscription;
  }
  return null;
}

export async function linkPolarCustomerToOrg(args: {
  customerId: string;
  orgId: string;
}) {
  return polarClient.customers.update({
    id: args.customerId,
    customerUpdate: { externalId: args.orgId },
  });
}

export async function getPolarCustomerForOrg(orgId: string) {
  try {
    return await polarClient.customers.getExternal({ externalId: orgId });
  } catch (error) {
    if (error instanceof ResourceNotFound) return null;
    throw error;
  }
}
