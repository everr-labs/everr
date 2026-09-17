import * as z from "zod";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { db } from "@/db/client";
import { auth } from "@/lib/auth.server";
import { generateOrgSlug } from "@/lib/auto-org";
import { billing } from "@/lib/billing/server";
import {
  lockHobbyOrganizationOwnership,
  userOwnsHobbyOrganization,
} from "@/lib/billing-data.server";
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
      return await billing.startNewOrganizationCheckout(
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
      return billing.completeNewOrganizationCheckout(
        data.checkoutId,
        session.user.id,
        (input) => auth.api.createOrganization(input),
      );
    });
