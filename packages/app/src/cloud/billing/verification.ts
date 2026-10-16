import { assertPolarProductGrantsPlan } from "./catalog.server";
import { assertTeam } from "./identity";
import {
  type BillingDependencies,
  BillingError,
  type Checkout,
  type Subscription,
} from "./types";
export function assertSession(
  checkout: Checkout,
  orgId: string,
  customerId: string,
) {
  if (
    checkout.customerId !== customerId ||
    checkout.externalCustomerId !== orgId
  )
    throw new BillingError(
      "identity_conflict",
      "Checkout does not belong to this organization.",
    );
  if (!checkout.productId)
    throw new BillingError(
      "unsupported_checkout",
      "Checkout has no configured product.",
    );
  assertPolarProductGrantsPlan(checkout.productId, "pro");
}
export function assertSubscription(
  checkout: Checkout,
  subscription: Subscription,
) {
  if (
    subscription.checkoutId !== checkout.id ||
    subscription.customerId !== checkout.customerId ||
    subscription.productId !== checkout.productId ||
    (checkout.subscriptionId && checkout.subscriptionId !== subscription.id)
  )
    throw new BillingError(
      "identity_conflict",
      "Subscription does not match its checkout.",
    );
}
export async function verifyPayment(
  polar: BillingDependencies["polar"],
  checkout: Checkout,
  orgId: string,
  customerId: string,
) {
  assertSession(checkout, orgId, customerId);
  assertTeam(await polar.getCustomer(customerId), orgId);
  if (checkout.status !== "succeeded") return null;
  const subscription = await polar.checkoutSubscription(checkout);
  if (!subscription || subscription.status !== "active") return null;
  assertSubscription(checkout, subscription);
  return subscription;
}
