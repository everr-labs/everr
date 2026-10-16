import { createFileRoute } from "@tanstack/react-router";
import {
  loadSuspendedOrganization,
  SuspendedOrganizationPage,
} from "@/cloud/pages/suspended";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_padded/billing_/suspended",
)({
  staticData: {
    breadcrumb: "Subscription suspended",
    hideTimeRangePicker: true,
  },
  head: () => ({ meta: [{ title: "Everr - Subscription suspended" }] }),
  loader: loadSuspendedOrganization,
  component: SuspendedOrganizationPage,
});
