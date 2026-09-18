import { polar, webhooks } from "@polar-sh/better-auth";
import { env } from "@/env";
import { polarClient } from "./polar.server";
import { billing } from "./server";
import type { CreateOrganization } from "./types";
export function billingAuthPlugin(createOrganization: CreateOrganization) {
  const sync = (event: Parameters<typeof billing.syncSubscription>[0]) =>
    billing.syncSubscription(event, createOrganization);
  return polar({
    client: polarClient,
    createCustomerOnSignUp: false,
    use: [
      webhooks({
        secret: env.POLAR_WEBHOOK_SECRET,
        onSubscriptionCreated: sync,
        onSubscriptionUpdated: sync,
        onSubscriptionActive: sync,
        onSubscriptionUncanceled: sync,
        onSubscriptionCanceled: sync,
        onSubscriptionRevoked: sync,
      }),
    ],
  });
}
