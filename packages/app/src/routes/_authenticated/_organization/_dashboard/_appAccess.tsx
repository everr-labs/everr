import { navigation } from "@composition/navigation";
import { createFileRoute } from "@tanstack/react-router";
import { getActiveOrgPolicy } from "#app/data/product.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess",
)({
  beforeLoad: async () => {
    const entitlement = await getActiveOrgPolicy();
    navigation.ensureAppAccess(entitlement);
    return { entitlement };
  },
});
