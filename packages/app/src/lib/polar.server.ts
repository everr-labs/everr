import { Polar } from "@polar-sh/sdk";
import { HTTPValidationError } from "@polar-sh/sdk/models/errors/httpvalidationerror";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import { BillingEmailUnavailableError } from "@/common/organization-name";
import { env } from "@/env";

export const polarClient = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  server: env.POLAR_SERVER,
});

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
}) {
  try {
    return await polarClient.customers.create({
      email: args.email,
      name: args.name,
      externalId: args.externalId,
    });
  } catch (error) {
    if (isBillingEmailConflict(error)) {
      throw new BillingEmailUnavailableError();
    }
    throw error;
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

export async function ensurePolarCustomerForOrg(args: {
  orgId: string;
  orgName: string;
  fallbackEmail: string;
}) {
  try {
    return await polarClient.customers.getExternal({ externalId: args.orgId });
  } catch (err) {
    if (!(err instanceof ResourceNotFound)) throw err;
    return createPolarCustomer({
      externalId: args.orgId,
      email: args.fallbackEmail,
      name: args.orgName,
    });
  }
}
