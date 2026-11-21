import { navigation } from "@composition/navigation";
import { createFileRoute } from "@tanstack/react-router";
import { getActiveOrgPolicy } from "#app/data/product.ts";
import { routeAccessQuery } from "#app/lib/route-access-cache.ts";

const organizationPolicyQuery = (organizationId: string) =>
  routeAccessQuery(["policy", organizationId], () => getActiveOrgPolicy());

export const Route = createFileRoute("/_authenticated/_organization/_dashboard/_appAccess")({
  beforeLoad: async ({ context: { queryClient, organization } }) => {
    const entitlement = await queryClient.ensureQueryData(organizationPolicyQuery(organization.id));
    navigation.ensureAppAccess(entitlement);
    return { entitlement };
  },
});
