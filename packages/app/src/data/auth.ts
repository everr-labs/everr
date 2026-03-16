import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { workOS } from "@/lib/workos";

export const getCurrentOrganization = createAuthenticatedServerFn().handler(
  async ({ context: { auth } }) => {
    return workOS.organizations.getOrganization(auth.organizationId);
  },
);

export const updateOrganizationName = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CreateOrganizationInputSchema)
  .handler(async ({ data, context: { auth } }) => {
    const organization = await workOS.organizations.updateOrganization({
      organization: auth.organizationId,
      name: data.organizationName,
    });

    return {
      organizationId: organization.id,
      organizationName: organization.name,
    };
  });
