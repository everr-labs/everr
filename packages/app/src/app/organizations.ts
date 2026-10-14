import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { auth } from "@/lib/auth.server";
import { generateOrgSlug } from "@/lib/auto-org";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";
import type { OrganizationCreationResult } from "@/product/organization-creation";

export const getOrganizationCreationOptions =
  createPartiallyAuthenticatedServerFn({ method: "GET" }).handler(async () => ({
    canCreateHobby: false,
  }));

export const createOrganization = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CreateOrganizationInputSchema)
  .handler(
    async ({
      data,
      context: { session },
    }): Promise<OrganizationCreationResult> => {
      if (data.plan)
        throw new Error("Plans are unavailable on this installation.");
      const organization = await auth.api.createOrganization({
        body: {
          name: data.organizationName,
          slug: generateOrgSlug(),
          userId: session.user.id,
          plan: "self-hosted",
        },
      });
      if (!organization)
        throw new Error("The organization could not be created.");
      return {
        kind: "created" as const,
        organization: { id: organization.id, name: organization.name },
      };
    },
  );
