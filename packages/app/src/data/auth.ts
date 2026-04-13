import { queryOptions } from "@tanstack/react-query";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { auth } from "@/lib/auth.server";
import {
  createAuthenticatedServerFn,
  createPartiallyAuthenticatedServerFn,
} from "@/lib/serverFn";

export const getActiveOrganization = createPartiallyAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  if (!session.session.activeOrganizationId) {
    return null;
  }

  const org = await auth.api.getFullOrganization({
    query: { organizationId: session.session.activeOrganizationId },
    headers: getRequestHeaders(),
  });

  return org;
});

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
  .handler(async ({ data, context: { session } }) => {
    const org = await auth.api.updateOrganization({
      body: {
        organizationId: session.session.activeOrganizationId,
        data: { name: data.organizationName },
      },
      headers: getRequestHeaders(),
    });

    return {
      organizationId: org?.id ?? session.session.activeOrganizationId,
      organizationName: data.organizationName,
    };
  });

export const markOnboardingComplete = createAuthenticatedServerFn({
  method: "POST",
}).handler(async ({ context: { session } }) => {
  await auth.api.updateOrganization({
    body: {
      organizationId: session.session.activeOrganizationId,
      data: { metadata: { onboardingCompleted: true } },
    },
    headers: getRequestHeaders(),
  });
});
