import { env } from "@everr/app/env";
import { serverLogger } from "@everr/app/telemetry/logger";
import { createPolar, createPolarCore, errors, type Polar } from "@polar-sh/sdk/2026-10";
import { z } from "zod";
import { appEnv as cloudEnv } from "../app/env";
import { polarProductIdForPlan } from "./catalog.server";
import { BillingError, type PolarGateway } from "./types";

const polarOptions = {
  accessToken: cloudEnv.POLAR_ACCESS_TOKEN,
  environment: cloudEnv.POLAR_SERVER,
} as const;
export const polarClient = createPolar(polarOptions);
export const polarCore = createPolarCore(polarOptions);

type PolarCustomer = Awaited<ReturnType<Polar["customers"]["get"]>>;
type PolarMember = Awaited<ReturnType<Polar["customers"]["members"]["create"]>>;
type PolarCheckout = Awaited<ReturnType<Polar["checkouts"]["get"]>>;
type PolarSubscription = Awaited<ReturnType<Polar["subscriptions"]["get"]>>;

function normalizeCustomer(customer: PolarCustomer) {
  return {
    id: customer.id,
    externalId: customer.external_id,
    type: customer.type,
  };
}

function normalizeCheckout(checkout: PolarCheckout) {
  return {
    id: checkout.id,
    status: checkout.status,
    url: checkout.url,
    successUrl: checkout.success_url,
    expiresAt: new Date(checkout.expires_at),
    customerId: checkout.customer_id,
    externalCustomerId: checkout.external_customer_id,
    productId: checkout.product_id,
    subscriptionId: checkout.subscription_id,
    metadata: checkout.metadata,
  };
}

export function normalizeSubscription(subscription: PolarSubscription) {
  return {
    id: subscription.id,
    customerId: subscription.customer_id,
    checkoutId: subscription.checkout_id,
    productId: subscription.product_id,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end)
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    modifiedAt: subscription.modified_at ? new Date(subscription.modified_at) : null,
    createdAt: new Date(subscription.created_at),
  };
}
async function missing<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof errors.ResourceNotFound) return null;
    throw error;
  }
}
function normalizeMember(member: PolarMember) {
  return {
    id: member.id,
    customerId: member.customer_id,
    externalId: member.external_id,
    name: member.name,
    email: member.email,
    role: z.enum(["owner", "billing_manager", "member"]).parse(member.role),
  };
}
function guarded<Args extends unknown[], Result>(
  operation: string,
  run: (...args: Args) => Promise<Result>,
) {
  return async (...args: Args): Promise<Result> => {
    try {
      return await run(...args);
    } catch (cause) {
      const details = z.object({ statusCode: z.number().optional() }).safeParse(cause);
      const status = details.success ? details.data.statusCode : undefined;
      serverLogger.error("billing.provider.failed", {
        "everr.billing.operation": operation,
        "error.type": cause instanceof Error ? cause.name : "UnknownError",
        ...(status === undefined ? {} : { "http.response.status_code": status }),
      });
      if (cause instanceof BillingError) throw cause;
      throw new BillingError(
        status !== undefined && [400, 404, 409, 422].includes(status)
          ? "identity_conflict"
          : "unavailable",
        "Billing could not complete this operation. Please try again or resolve the billing identity conflict.",
        cause,
      );
    }
  };
}
export function createPolarGateway(client: Polar = polarClient): PolarGateway {
  const gateway: PolarGateway = {
    async findCustomer(externalId) {
      const customer = await missing(() => client.customers.getExternal(externalId));
      return customer ? normalizeCustomer(customer) : null;
    },
    async getCustomer(id) {
      return normalizeCustomer(await client.customers.get(id));
    },
    async createTeam({ orgId, name, owner }) {
      return normalizeCustomer(
        await client.customers.create({
          type: "team",
          external_id: orgId,
          name,
          owner: { external_id: owner.id, email: owner.email, name: owner.name },
        }),
      );
    },
    async members(customerId) {
      const members = [];
      for await (const member of client.customers.members.iterList(customerId, { limit: 100 }))
        members.push(normalizeMember(member));
      return members;
    },
    createMember: async (customerId, person) =>
      normalizeMember(
        await client.customers.members.create(customerId, {
          external_id: person.id,
          email: person.email,
          name: person.name,
          role: "billing_manager",
        }),
      ),
    async updateMember(customerId, id, input) {
      return normalizeMember(await client.customers.members.update(customerId, id, input));
    },
    async deleteMember(customerId, id) {
      await missing(() => client.customers.members.delete(customerId, id));
    },
    async portal(customerId, memberId) {
      return (
        await client.customerSessions.create({ customer_id: customerId, member_id: memberId })
      ).customer_portal_url;
    },
    async checkout(id) {
      return normalizeCheckout(await client.checkouts.get(id));
    },
    async checkouts(customerId) {
      const result = [];
      for await (const checkout of client.checkouts.iterList({
        customer_id: customerId,
        limit: 100,
        sorting: ["-created_at"],
      }))
        result.push(normalizeCheckout(checkout));
      return result;
    },
    async createCheckout({ customerId, orgId, metadata, successUrl }) {
      return normalizeCheckout(
        await client.checkouts.create({
          customer_id: customerId,
          external_customer_id: orgId,
          metadata,
          products: [polarProductIdForPlan("pro")],
          allow_trial: false,
          success_url: successUrl,
          return_url: env.BETTER_AUTH_URL,
        }),
      );
    },
    async subscription(id) {
      return normalizeSubscription(await client.subscriptions.get(id));
    },
    async updateCheckoutSuccessUrl(id, successUrl) {
      return normalizeCheckout(await client.checkouts.update(id, { success_url: successUrl }));
    },
    async checkoutSubscription(checkout) {
      if (!checkout.customerId || !checkout.productId) return null;
      const matches = (s: { checkoutId?: string | null; customerId: string; productId: string }) =>
        s.checkoutId === checkout.id &&
        s.customerId === checkout.customerId &&
        s.productId === checkout.productId;
      if (checkout.subscriptionId) {
        const s = normalizeSubscription(await client.subscriptions.get(checkout.subscriptionId));
        return matches(s) ? s : null;
      }
      for await (const subscription of client.subscriptions.iterList({
        customer_id: checkout.customerId,
        product_id: checkout.productId,
        active: true,
        limit: 100,
      })) {
        const s = normalizeSubscription(subscription);
        if (matches(s)) return s;
      }
      return null;
    },
    async revokeSubscription(id) {
      await missing(async () => {
        const s = await client.subscriptions.get(id);
        if (s.status !== "canceled" && s.status !== "incomplete_expired")
          await client.subscriptions.revoke(id);
      });
    },
  };
  return {
    findCustomer: guarded("findCustomer", gateway.findCustomer),
    getCustomer: guarded("getCustomer", gateway.getCustomer),
    createTeam: guarded("createTeam", gateway.createTeam),
    members: guarded("members", gateway.members),
    createMember: guarded("createMember", gateway.createMember),
    updateMember: guarded("updateMember", gateway.updateMember),
    deleteMember: guarded("deleteMember", gateway.deleteMember),
    portal: guarded("portal", gateway.portal),
    checkout: guarded("checkout", gateway.checkout),
    checkouts: guarded("checkouts", gateway.checkouts),
    createCheckout: guarded("createCheckout", gateway.createCheckout),
    updateCheckoutSuccessUrl: guarded("updateCheckoutSuccessUrl", gateway.updateCheckoutSuccessUrl),
    subscription: guarded("subscription", gateway.subscription),
    checkoutSubscription: guarded("checkoutSubscription", gateway.checkoutSubscription),
    revokeSubscription: guarded("revokeSubscription", gateway.revokeSubscription),
  };
}
