import { navigation } from "@composition/navigation";
import { createFileRoute } from "@tanstack/react-router";
import { getActiveOrgPolicy } from "#app/data/product.ts";
import {
  ensureRouteAccess,
  refetchRouteAccess,
  routeAccessQuery,
} from "#app/lib/route-access-cache.ts";

const policyKey = (organizationId: string) => ["policy", organizationId];

export const Route = createFileRoute("/_authenticated/_organization/_dashboard/_appAccess")({
  beforeLoad: async ({ context: { queryClient, organization }, location }) => {
    const entitlement = await ensureRouteAccess(
      queryClient,
      routeAccessQuery(policyKey(organization.id), () => getActiveOrgPolicy()),
      location.href,
    );
    try {
      navigation.ensureAppAccess(entitlement);
      return { entitlement };
    } catch (refusal) {
      // A restored subscription or an upgrade made elsewhere leaves the cached
      // policy refusing.
      const fresh = await refetchRouteAccess<typeof entitlement>(
        queryClient,
        policyKey(organization.id),
      );
      if (!fresh) throw refusal;
      navigation.ensureAppAccess(fresh);
      return { entitlement: fresh };
    }
  },
});
