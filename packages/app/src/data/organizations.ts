import { getRequestHeaders } from "@tanstack/react-start/server";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { auth } from "@/lib/auth.server";
import { generateOrgSlug } from "@/lib/auto-org";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

export const createOrganization = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CreateOrganizationInputSchema)
  .handler(async ({ data }) => {
    const organization = await auth.api.createOrganization({
      headers: getRequestHeaders(),
      body: {
        name: data.organizationName,
        slug: generateOrgSlug(),
      },
    });

    if (!organization) {
      throw new Error("The organization could not be created.");
    }

    return { id: organization.id, name: organization.name };
  });
