import * as z from "zod";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { db } from "@/db/client";
import { env } from "@/env";
import { auth, finalizeProOrganizationCheckout } from "@/lib/auth.server";
import { generateOrgSlug } from "@/lib/auto-org";
import {
  assertPolarProductGrantsPlan,
  polarProductIdForPlan,
} from "@/lib/billing-catalog.server";
import {
  lockHobbyOrganizationOwnership,
  userOwnsHobbyOrganization,
} from "@/lib/billing-data.server";
import {
  deleteProvisionalPolarCustomer,
  getPolarCheckoutSubscription,
  polarClient,
  prepareProOrganizationCheckoutCustomer,
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

    const organizationSlug = generateOrgSlug();
    const metadata = {
      everrPurpose: "create_pro_organization",
      everrOwnerId: session.user.id,
      everrOrganizationName: data.organizationName,
      everrOrganizationSlug: organizationSlug,
      everrSchemaVersion: 1,
    } as const;

    const successUrl = new URL(
      "/organizations/checkout/success?checkout_id={CHECKOUT_ID}",
      env.BETTER_AUTH_URL,
    ).toString();
    const returnUrl = new URL(
      "/organizations/new",
      env.BETTER_AUTH_URL,
    ).toString();
    const prepared = await prepareProOrganizationCheckoutCustomer({
      email: data.billingEmail,
      name: data.organizationName,
      metadata,
    });
    if (prepared.kind === "checkout") {
      if (prepared.checkout.status === "open") {
        return { kind: "checkout" as const, url: prepared.checkout.url };
      }
      const completionUrl = new URL(
        "/organizations/checkout/success",
        env.BETTER_AUTH_URL,
      );
      completionUrl.searchParams.set("checkout_id", prepared.checkout.id);
      return { kind: "checkout" as const, url: completionUrl.toString() };
    }

    let checkout: Awaited<ReturnType<typeof polarClient.checkouts.create>>;
    try {
      checkout = await polarClient.checkouts.create({
        products: [polarProductIdForPlan("pro")],
        customerId: prepared.customerId,
        allowTrial: false,
        successUrl,
        returnUrl,
        metadata,
      });
    } catch (error) {
      if (prepared.created) {
        await rollbackPolarCustomer(prepared.customerId);
      }
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
