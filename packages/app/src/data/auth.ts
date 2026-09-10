import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth.server";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

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
