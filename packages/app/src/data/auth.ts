import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { workOS } from "@/lib/workos";

/**
 * Get the current organization for the authenticated user.
 * @returns The current organization or null if the user does not have an organization.
 */
export const getActiveOrganization = createServerFn().handler(
  async ({ context: { auth } }) => {
    const authResult = auth();
    if (!authResult.user) {
      throw new Error("No user found");
    }

    if (!authResult.organizationId) {
      return null;
    }

    return workOS.organizations.getOrganization(authResult.organizationId);
  },
);

export const activeOrganizationOptions = () =>
  queryOptions({
    queryKey: ["organization"],
    queryFn: () => getActiveOrganization(),
    staleTime: Infinity,
  });

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

export const markOnboardingComplete = createAuthenticatedServerFn({
  method: "POST",
}).handler(async ({ context: { auth } }) => {
  return workOS.organizations.updateOrganization({
    organization: auth.organizationId,
    metadata: { onboardingCompleted: "true" },
  });
});
