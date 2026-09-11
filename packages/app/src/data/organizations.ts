import { getRequestHeaders } from "@tanstack/react-start/server";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { auth } from "@/lib/auth.server";
import { generateOrgSlug } from "@/lib/auto-org";
import {
  assertPolarBillingEmailAvailable,
  createPolarCustomer,
  deleteProvisionalPolarCustomer,
  getPolarCustomerForOrg,
  linkPolarCustomerToOrg,
} from "@/lib/polar.server";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

class OrganizationCreationError extends Error {
  name = "OrganizationCreationError";

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}

async function rollbackPolarCustomer(
  customerId: string,
  organizationId?: string,
) {
  try {
    await deleteProvisionalPolarCustomer(customerId);
    return true;
  } catch (error) {
    serverLogger.error("polar.customer.rollback.failed", {
      ...exceptionAttributes(error),
      "everr.polar.customer.id": customerId,
      ...(organizationId
        ? { "everr.organization.id": organizationId }
        : undefined),
    });
    return false;
  }
}

async function rollbackOrganization(
  organizationId: string,
  customerId: string,
  headers: Headers,
) {
  // Remove the just-created, subscription-free customer first. If the Polar
  // link succeeded but its response was lost, this also clears the external
  // ID so the Organization deletion guard can safely allow compensation.
  const customerDeleted = await rollbackPolarCustomer(
    customerId,
    organizationId,
  );
  if (!customerDeleted) return;

  try {
    await auth.api.deleteOrganization({
      headers,
      body: { organizationId },
    });
  } catch (error) {
    serverLogger.error("organization.create.rollback.failed", {
      ...exceptionAttributes(error),
      "everr.organization.id": organizationId,
    });
  }
}

export const createOrganization = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CreateOrganizationInputSchema)
  .handler(async ({ data, context: { session } }) => {
    await assertPolarBillingEmailAvailable(data.billingEmail);
    const headers = getRequestHeaders();

    const customer = await createPolarCustomer({
      email: data.billingEmail,
      name: data.organizationName,
    });

    let organization: Awaited<ReturnType<typeof auth.api.createOrganization>>;

    try {
      organization = await auth.api.createOrganization({
        body: {
          name: data.organizationName,
          slug: generateOrgSlug(),
          userId: session.user.id,
        },
      });
    } catch (error) {
      await rollbackPolarCustomer(customer.id);
      throw new OrganizationCreationError(
        "The organization could not be created.",
        error,
      );
    }

    if (!organization) {
      await rollbackPolarCustomer(customer.id);
      throw new OrganizationCreationError(
        "The organization could not be created.",
      );
    }

    try {
      await linkPolarCustomerToOrg({
        customerId: customer.id,
        orgId: organization.id,
      });
    } catch (error) {
      try {
        const linkedCustomer = await getPolarCustomerForOrg(organization.id);
        if (linkedCustomer?.id === customer.id) {
          return { id: organization.id, name: organization.name };
        }
      } catch (verificationError) {
        serverLogger.error("polar.customer.link_verification.failed", {
          ...exceptionAttributes(verificationError),
          "everr.organization.id": organization.id,
          "everr.polar.customer.id": customer.id,
        });
      }

      await rollbackOrganization(organization.id, customer.id, headers);
      throw new OrganizationCreationError(
        "The billing customer could not be linked to the organization.",
        error,
      );
    }

    return { id: organization.id, name: organization.name };
  });
