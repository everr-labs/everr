import { polar, webhooks } from "@polar-sh/better-auth";
import { appEnv as cloudEnv } from "../app/env";
import type { polarClient } from "./polar.server";
import { normalizeSubscription, polarCore } from "./polar.server";
import { billing } from "./server";
import type { CreateOrganization } from "./types";

type PolarSubscription = Awaited<ReturnType<typeof polarClient.subscriptions.get>>;

export function billingAuthPlugin(createOrganization: CreateOrganization) {
  const sync = (event: { data: PolarSubscription }) => {
    const { data } = event;
    return billing.syncSubscription(
      {
        data: {
          ...normalizeSubscription(data),
          metadata: data.metadata,
          customer: { id: data.customer.id, externalId: data.customer.external_id },
        },
      },
      createOrganization,
    );
  };
  return polar({
    client: polarCore,
    createCustomerOnSignUp: false,
    use: [
      webhooks({
        secret: cloudEnv.POLAR_WEBHOOK_SECRET,
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
