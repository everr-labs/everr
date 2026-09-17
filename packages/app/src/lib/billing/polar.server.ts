import { Polar } from "@polar-sh/sdk";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import { z } from "zod";
import { env } from "@/env";
import { serverLogger } from "@/telemetry/logger";
import { polarProductIdForPlan } from "./catalog.server";
import { BillingError, type PolarGateway } from "./types";

const memberResponse = z.object({
  id: z.string(),
  customer_id: z.string(),
  external_id: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.enum(["owner", "billing_manager", "member"]),
});
export const polarClient = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  server: env.POLAR_SERVER,
});
async function missing<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ResourceNotFound) return null;
    throw error;
  }
}
function normalizeMember(member: {
  id: string;
  customerId: string;
  externalId: string | null;
  name: string | null;
  email: string;
  role: unknown;
}) {
  return {
    ...member,
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
      const details = z
        .object({ statusCode: z.number().optional() })
        .safeParse(cause);
      const status = details.success ? details.data.statusCode : undefined;
      serverLogger.error("billing.provider.failed", {
        "everr.billing.operation": operation,
        "error.type": cause instanceof Error ? cause.name : "UnknownError",
        ...(status === undefined
          ? {}
          : { "http.response.status_code": status }),
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
    findCustomer: (externalId) =>
      missing(() => client.customers.getExternal({ externalId })),
    getCustomer: (id) => client.customers.get({ id }),
    createTeam: ({ orgId, name, owner }) =>
      client.customers.create({
        type: "team",
        externalId: orgId,
        name,
        owner: { externalId: owner.id, email: owner.email, name: owner.name },
      }),
    async members(customerId) {
      const result = [];
      const pages = await client.members.listMembers({
        customerId,
        limit: 100,
      });
      for await (const page of pages) result.push(...page.result.items);
      return result.map(normalizeMember);
    },
    createMember: async (customerId, person) =>
      normalizeMember(
        await client.members.createMember({
          customerId,
          externalId: person.id,
          email: person.email,
          name: person.name,
          role: "billing_manager",
        }),
      ),
    async updateMember(id, input) {
      // The installed SDK omits email from MemberUpdate. Use the documented
      // endpoint with a validated response rather than casting away that contract.
      if (input.email === undefined)
        return normalizeMember(
          await client.members.updateMember({ id, memberUpdate: input }),
        );
      const base =
        env.POLAR_SERVER === "sandbox"
          ? "https://sandbox-api.polar.sh"
          : "https://api.polar.sh";
      const response = await fetch(
        `${base}/v1/members/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        throw new BillingError(
          response.status === 422 ? "identity_conflict" : "unavailable",
          "Polar could not update the billing member.",
        );
      const member = memberResponse.parse(await response.json());
      return {
        id: member.id,
        customerId: member.customer_id,
        externalId: member.external_id,
        email: member.email,
        name: member.name,
        role: member.role,
      };
    },
    async deleteMember(id) {
      await missing(() => client.members.deleteMember({ id }));
    },
    async portal(customerId, memberId) {
      return (await client.customerSessions.create({ customerId, memberId }))
        .customerPortalUrl;
    },
    checkout: (id) => client.checkouts.get({ id }),
    async checkouts(customerId) {
      const result = [];
      const pages = await client.checkouts.list({
        customerId,
        limit: 100,
        sorting: ["-created_at"],
      });
      for await (const page of pages) result.push(...page.result.items);
      return result;
    },
    createCheckout: ({ customerId, orgId, metadata, successUrl }) =>
      client.checkouts.create({
        customerId,
        externalCustomerId: orgId,
        metadata,
        products: [polarProductIdForPlan("pro")],
        allowTrial: false,
        successUrl,
        returnUrl: env.BETTER_AUTH_URL,
      }),
    subscription: (id) => client.subscriptions.get({ id }),
    async checkoutSubscription(checkout) {
      if (!checkout.customerId || !checkout.productId) return null;
      const matches = (s: {
        checkoutId?: string | null;
        customerId: string;
        productId: string;
      }) =>
        s.checkoutId === checkout.id &&
        s.customerId === checkout.customerId &&
        s.productId === checkout.productId;
      if (checkout.subscriptionId) {
        const s = await client.subscriptions.get({
          id: checkout.subscriptionId,
        });
        return matches(s) ? s : null;
      }
      const pages = await client.subscriptions.list({
        customerId: checkout.customerId,
        productId: checkout.productId,
        active: true,
        limit: 100,
      });
      for await (const page of pages) {
        const s = page.result.items.find(matches);
        if (s) return s;
      }
      return null;
    },
    async revokeSubscription(id) {
      await missing(async () => {
        const s = await client.subscriptions.get({ id });
        if (s.status !== "canceled" && s.status !== "incomplete_expired")
          await client.subscriptions.revoke({ id });
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
    subscription: guarded("subscription", gateway.subscription),
    checkoutSubscription: guarded(
      "checkoutSubscription",
      gateway.checkoutSubscription,
    ),
    revokeSubscription: guarded(
      "revokeSubscription",
      gateway.revokeSubscription,
    ),
  };
}
