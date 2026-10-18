import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "#app/lib/auth.server.ts";
import { createPartiallyAuthenticatedServerFn } from "#app/lib/serverFn.ts";

export const getOrganizations = createPartiallyAuthenticatedServerFn({
  method: "GET",
}).handler(async () => {
  const organizations = await auth.api.listOrganizations({
    headers: getRequestHeaders(),
  });
  return organizations.map(({ id, name }) => ({ id, name }));
});

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
