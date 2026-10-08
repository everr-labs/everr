import { createFileRoute, redirect } from "@tanstack/react-router";
import { isOrganizationProvisioned } from "@/common/organization-provisioning";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned",
)({
  staticData: { showDataControls: true },
  beforeLoad: ({ context: { organization }, location }) => {
    if (!isOrganizationProvisioned(organization.metadata))
      throw redirect({
        to: "/organization-pending",
        search: { returnTo: location.href },
        replace: true,
      });
  },
});
