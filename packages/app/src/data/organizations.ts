import * as z from "zod";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { env } from "@/env";
import { auth, finalizeProOrganizationCheckout } from "@/lib/auth.server";
import { generateOrgSlug } from "@/lib/auto-org";
import {
  assertPolarProductGrantsPlan,
  polarProductIdForPlan,
} from "@/lib/billing-catalog.server";
import { userOwnsHobbyOrganization } from "@/lib/billing-data.server";
import {
  assertPolarBillingEmailAvailable,
  createPolarCustomer,
  deleteProvisionalPolarCustomer,
  polarClient,
} from "@/lib/polar.server";
import { ProOrganizationCheckoutMetadataSchema } from "@/lib/pro-organization-checkout";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

class OrganizationCreationError extends Error {
  name = "OrganizationCreationError";

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}

class HobbyOrganizationLimitError extends Error {
  name = "HobbyOrganizationLimitError";

  constructor() {
    super("You already own a Hobby organization. Create this one on Pro.");
  }
}

async function rollbackPolarCustomer(customerId: string) {
  try {
    await deleteProvisionalPolarCustomer(customerId);
  } catch (error) {
    serverLogger.error("polar.customer.rollback.failed", {
      ...exceptionAttributes(error),
      "everr.polar.customer.id": customerId,
    });
  }
}

export const getOrganizationCreationOptions =
  createPartiallyAuthenticatedServerFn({ method: "GET" }).handler(
    async ({ context: { session } }) => ({
      canCreateHobby: !(await userOwnsHobbyOrganization(session.user.id)),
    }),
  );

export const createOrganization = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CreateOrganizationInputSchema)
  .handler(async ({ data, context: { session } }) => {
    if (data.plan === "hobby") {
      if (await userOwnsHobbyOrganization(session.user.id)) {
        throw new HobbyOrganizationLimitError();
      }

      const organization = await auth.api.createOrganization({
        body: {
          name: data.organizationName,
          slug: generateOrgSlug(),
          userId: session.user.id,
          plan: "hobby",
        },
      });
      if (!organization) {
        throw new OrganizationCreationError(
          "The organization could not be created.",
        );
      }

      return {
        kind: "created" as const,
        organization: { id: organization.id, name: organization.name },
      };
    }

    await assertPolarBillingEmailAvailable(data.billingEmail);
    const customer = await createPolarCustomer({
      email: data.billingEmail,
      name: data.organizationName,
    });
    const organizationSlug = generateOrgSlug();

    const successUrl = new URL(
      "/organizations/checkout/success?checkout_id={CHECKOUT_ID}",
      env.BETTER_AUTH_URL,
    ).toString();
    const returnUrl = new URL("/", env.BETTER_AUTH_URL).toString();
    let checkout: Awaited<ReturnType<typeof polarClient.checkouts.create>>;
    try {
      checkout = await polarClient.checkouts.create({
        products: [polarProductIdForPlan("pro")],
        customerId: customer.id,
        allowTrial: false,
        successUrl,
        returnUrl,
        metadata: {
          everrPurpose: "create_pro_organization",
          everrOwnerId: session.user.id,
          everrOrganizationName: data.organizationName,
          everrOrganizationSlug: organizationSlug,
          everrSchemaVersion: 1,
        },
      });
    } catch (error) {
      await rollbackPolarCustomer(customer.id);
      throw new OrganizationCreationError(
        "Pro checkout could not be started.",
        error,
      );
    }

    return { kind: "checkout" as const, url: checkout.url };
  });

const CheckoutResultSchema = z.object({ checkoutId: z.string().min(1) });

export const completeProOrganizationCheckout =
  createPartiallyAuthenticatedServerFn({ method: "POST" })
    .inputValidator(CheckoutResultSchema)
    .handler(async ({ data, context: { session } }) => {
      const checkout = await polarClient.checkouts.get({ id: data.checkoutId });
      if (checkout.status === "confirmed") {
        return { status: "processing" as const };
      }
      const metadata = ProOrganizationCheckoutMetadataSchema.safeParse(
        checkout.metadata,
      );
      if (
        checkout.status !== "succeeded" ||
        !checkout.productId ||
        !checkout.subscriptionId ||
        !checkout.customerId ||
        !metadata.success
      ) {
        throw new OrganizationCreationError(
          "Polar has not confirmed an active Pro subscription.",
        );
      }
      assertPolarProductGrantsPlan(checkout.productId, "pro");

      if (metadata.data.everrOwnerId !== session.user.id) {
        throw new OrganizationCreationError("This checkout is not available.");
      }

      const subscription = await polarClient.subscriptions.get({
        id: checkout.subscriptionId,
      });
      if (subscription.status !== "active" || !subscription.productId) {
        throw new OrganizationCreationError(
          "Polar has not confirmed an active Pro subscription.",
        );
      }
      assertPolarProductGrantsPlan(subscription.productId, "pro");

      return finalizeProOrganizationCheckout({
        metadata: metadata.data,
        customerId: checkout.customerId,
        subscription: {
          id: subscription.id,
          productId: subscription.productId,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          modifiedAt: subscription.modifiedAt,
          createdAt: subscription.createdAt,
        },
      });
    });
