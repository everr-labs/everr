import * as z from "zod";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { db } from "@/db/client";
import { auth, finalizeProOrganizationCheckout } from "@/lib/auth.server";
import { generateOrgSlug } from "@/lib/auto-org";
import { assertPolarProductGrantsPlan } from "@/lib/billing-catalog.server";
import {
  lockHobbyOrganizationOwnership,
  userOwnsHobbyOrganization,
} from "@/lib/billing-data.server";
import { getPolarCheckoutSubscription, polarClient } from "@/lib/polar.server";
import { ProOrganizationCheckoutMetadataSchema } from "@/lib/pro-organization-checkout";
import { startProOrganizationCheckout } from "@/lib/pro-organization-checkout.server";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

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
      return db.transaction(async (tx) => {
        await lockHobbyOrganizationOwnership(tx, session.user.id);
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
      });
    }

    try {
      return await startProOrganizationCheckout(
        session.user.id,
        data.organizationName,
      );
    } catch (error) {
      throw new OrganizationCreationError(
        "Pro checkout could not be started. Please try again.",
        error,
      );
    }
  });

const CheckoutResultSchema = z.object({ checkoutId: z.string().min(1) });

export const completeProOrganizationCheckout =
  createPartiallyAuthenticatedServerFn({ method: "POST" })
    .inputValidator(CheckoutResultSchema)
    .handler(async ({ data, context: { session } }) => {
      const checkout = await polarClient.checkouts.get({ id: data.checkoutId });
      const metadata = ProOrganizationCheckoutMetadataSchema.safeParse(
        checkout.metadata,
      );
      if (!metadata.success || metadata.data.everrOwnerId !== session.user.id) {
        throw new OrganizationCreationError("This checkout is not available.");
      }
      if (
        metadata.data.everrSchemaVersion === 2 &&
        checkout.externalCustomerId !== metadata.data.everrOrganizationId
      ) {
        throw new OrganizationCreationError(
          "Checkout organization does not match.",
        );
      }
      if (checkout.status === "confirmed")
        return { status: "processing" as const };
      if (
        checkout.status !== "succeeded" ||
        !checkout.productId ||
        !checkout.customerId
      ) {
        throw new OrganizationCreationError(
          "Polar has not confirmed an active Pro subscription.",
        );
      }
      assertPolarProductGrantsPlan(checkout.productId, "pro");

      const subscription = await getPolarCheckoutSubscription(checkout);
      if (!subscription) {
        return { status: "processing" as const };
      }
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
