import { navigation } from "@composition/navigation";
import { createFileRoute } from "@tanstack/react-router";
import { getActiveOrgPolicy } from "@/data/product";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess",
)({
  beforeLoad: async () => {
    const entitlement = await getActiveOrgPolicy();
    navigation.ensureAppAccess(entitlement);
    return { entitlement };
  },
});
