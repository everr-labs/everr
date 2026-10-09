import { createFileRoute, redirect } from "@tanstack/react-router";
import { getActiveOrgAppAccess } from "@/data/billing";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess",
)({
  beforeLoad: async () => {
    const entitlement = await getActiveOrgAppAccess();
    if (entitlement.appState === "suspended")
      throw redirect({ to: "/billing/suspended", replace: true });
    return { entitlement };
  },
});
