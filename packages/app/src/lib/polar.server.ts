import { Polar } from "@polar-sh/sdk";
import { HTTPValidationError } from "@polar-sh/sdk/models/errors/httpvalidationerror";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import { BillingEmailUnavailableError } from "@/common/organization-name";
import { env } from "@/env";
import {
  type ProOrganizationCheckoutMetadata,
  ProOrganizationCheckoutMetadataSchema,
} from "@/lib/pro-organization-checkout";

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
  if (checkout.subscriptionId) {
    return polarClient.subscriptions.get({ id: checkout.subscriptionId });
  }
  if (!checkout.customerId || !checkout.productId) return null;

  const page = await polarClient.subscriptions.list({
    customerId: checkout.customerId,
    productId: checkout.productId,
    active: true,
    limit: 1,
  });
  return (
    page.result.items.find(
      (subscription) => subscription.checkoutId === checkout.id,
    ) ?? null
  );
}

function isBillingEmailConflict(error: unknown) {
  return (
    error instanceof HTTPValidationError &&
    error.detail?.some(
      (detail) =>
        detail.loc.includes("email") &&
        detail.msg.toLowerCase().includes("already exists"),
    )
  );
}

export async function assertPolarBillingEmailAvailable(email: string) {
  const page = await polarClient.customers.list({ email, limit: 1 });
  if (page.result.items.length > 0) {
    throw new BillingEmailUnavailableError();
  }
}

export async function createPolarCustomer(args: {
  email: string;
  name: string;
  externalId?: string;
  metadata?: Record<string, string | number | boolean>;
}) {
  try {
    return await polarClient.customers.create({
      email: args.email,
      name: args.name,
      externalId: args.externalId,
      metadata: args.metadata,
    });
  } catch (error) {
    if (isBillingEmailConflict(error)) {
      throw new BillingEmailUnavailableError();
    }
    throw error;
  }
}

type PreparedProOrganizationCheckoutCustomer =
  | {
      kind: "customer";
      customerId: string;
      created: boolean;
    }
  | {
      kind: "checkout";
      checkout: {
        id: string;
        status: "open" | "confirmed" | "succeeded";
        url: string;
      };
    };

async function findPolarCustomerByEmail(email: string) {
  const page = await polarClient.customers.list({ email, limit: 2 });
  const customers = page.result.items;
  if (customers.length > 1) {
    throw new BillingEmailUnavailableError();
  }
  return customers[0] ?? null;
}

async function prepareExistingProvisionalCustomer(args: {
  customer: NonNullable<Awaited<ReturnType<typeof findPolarCustomerByEmail>>>;
  name: string;
  metadata: ProOrganizationCheckoutMetadata;
}): Promise<PreparedProOrganizationCheckoutCustomer> {
  if (args.customer.externalId) {
    throw new BillingEmailUnavailableError();
  }

  const page = await polarClient.checkouts.list({
    customerId: args.customer.id,
    limit: 100,
    sorting: ["-created_at"],
  });
  const checkouts = page.result.items.map((checkout) => ({
    checkout,
    metadata: ProOrganizationCheckoutMetadataSchema.safeParse(
      checkout.metadata,
    ),
  }));
  const ownedCheckouts = checkouts.filter(
    ({ metadata }) =>
      metadata.success &&
      metadata.data.everrOwnerId === args.metadata.everrOwnerId,
  );
  const hasForeignCheckout = checkouts.some(
    ({ metadata }) =>
      metadata.success &&
      metadata.data.everrOwnerId !== args.metadata.everrOwnerId,
  );
  const hasUnknownCheckoutInProgress = checkouts.some(
    ({ checkout, metadata }) =>
      !metadata.success &&
      ["open", "confirmed", "succeeded"].includes(checkout.status),
  );
  if (hasForeignCheckout || hasUnknownCheckoutInProgress) {
    throw new BillingEmailUnavailableError();
  }

  for (const status of ["succeeded", "confirmed", "open"] as const) {
    const resumable = ownedCheckouts.find(
      ({ checkout }) =>
        checkout.status === status &&
        (status !== "open" || checkout.expiresAt.getTime() > Date.now()),
    );
    if (resumable) {
      return {
        kind: "checkout",
        checkout: {
          id: resumable.checkout.id,
          status,
          url: resumable.checkout.url,
        },
      };
    }
  }

  const customerMetadata = ProOrganizationCheckoutMetadataSchema.safeParse(
    args.customer.metadata,
  );
  const customerBelongsToOwner =
    customerMetadata.success &&
    customerMetadata.data.everrOwnerId === args.metadata.everrOwnerId;
  if (!customerBelongsToOwner && ownedCheckouts.length === 0) {
    throw new BillingEmailUnavailableError();
  }

  await polarClient.customers.update({
    id: args.customer.id,
    customerUpdate: { name: args.name, metadata: args.metadata },
  });
  return {
    kind: "customer",
    customerId: args.customer.id,
    created: false,
  };
}

export async function prepareProOrganizationCheckoutCustomer(args: {
  email: string;
  name: string;
  metadata: ProOrganizationCheckoutMetadata;
}): Promise<PreparedProOrganizationCheckoutCustomer> {
  const existing = await findPolarCustomerByEmail(args.email);
  if (existing) {
    return prepareExistingProvisionalCustomer({
      customer: existing,
      name: args.name,
      metadata: args.metadata,
    });
  }

  try {
    const customer = await createPolarCustomer({
      email: args.email,
      name: args.name,
      metadata: args.metadata,
    });
    return { kind: "customer", customerId: customer.id, created: true };
  } catch (error) {
    if (!(error instanceof BillingEmailUnavailableError)) throw error;

    const racedCustomer = await findPolarCustomerByEmail(args.email);
    if (!racedCustomer) throw error;
    return prepareExistingProvisionalCustomer({
      customer: racedCustomer,
      name: args.name,
      metadata: args.metadata,
    });
  }
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

export async function deleteProvisionalPolarCustomer(customerId: string) {
  await polarClient.customers.delete({ id: customerId, anonymize: true });
}

export async function getPolarCustomerForOrg(orgId: string) {
  try {
    return await polarClient.customers.getExternal({ externalId: orgId });
  } catch (error) {
    if (error instanceof ResourceNotFound) return null;
    throw error;
  }
}

export async function hasPolarCustomerForOrg(orgId: string) {
  return (await getPolarCustomerForOrg(orgId)) !== null;
}
