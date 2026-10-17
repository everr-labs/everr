import { billing } from "../billing/server";
import { userOwnsHobbyOrganization } from "../billing-data.server";
import { CreateOrganizationInputSchema } from "../common/organization-name";
import { db } from "@everr/app/db/client";
import { auth } from "@everr/app/lib/auth.server";
import { generateOrgSlug } from "@everr/app/lib/auto-org";
import { createPartiallyAuthenticatedServerFn } from "@everr/app/lib/serverFn";
import { lockOrganizationOwnership } from "@everr/app/product/organization-lock.server";

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
    if (!data.plan) throw new OrganizationCreationError("Choose a cloud plan.");
    if (data.plan === "hobby") {
      return db.transaction(async (tx) => {
        await lockOrganizationOwnership(tx, session.user.id);
        if (await userOwnsHobbyOrganization(session.user.id)) {
          throw new HobbyOrganizationLimitError();
        }

        const organization = await auth.api.createOrganization({
          body: {
            name: data.organizationName,
            slug: generateOrgSlug(),
            userId: session.user.id,
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
        data.returnTo,
      );
    } catch (error) {
      throw new OrganizationCreationError(
        "Pro checkout could not be started. Please try again.",
        error,
      );
    }
  });
