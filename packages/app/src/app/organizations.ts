import { CreateOrganizationInputSchema } from "@/common/organization-name";
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
  .handler(async ({ data }): Promise<OrganizationCreationResult> => {
    if (data.plan)
      throw new Error("Plans are unavailable on this installation.");
    throw new Error(
      "This installation supports one workspace. Contact your administrator for access.",
    );
  });
